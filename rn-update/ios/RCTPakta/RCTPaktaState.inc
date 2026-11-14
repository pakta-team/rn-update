typedef NS_ENUM(NSInteger, PaktaType) {
    PaktaTypeFullDownload = 1,
    PaktaTypePatchFromPackage = 2,
    PaktaTypePatchFromPpk = 3,
};

static std::atomic<bool> ignoreRollback{false};
// Whether the host asked +bundleURL for the bundle to load (the
// isUsingBundleUrl constant, mirroring Android/Harmony). NO means the app
// runs a bundle this SDK never resolved, so updates cannot take effect.
static std::atomic<bool> paktaIsUsingBundleUrl{false};
// Bumped by resetToPackagedBundle. The cold-start check runs for minutes and
// may already hold a decision when the app resets to the packaged bundle; it
// samples this counter and abandons activation (and its response cache) when
// the value moved, so an in-flight rescue can never resurrect the version the
// app just reset away from.
static std::atomic<uint64_t> paktaResetGeneration{0};
// The version whose bundle this process actually loaded (resolved in
// +bundleURL). resetToPackagedBundle must not delete its directory: update
// assets (images/fonts) are read from it on demand at runtime, so wiping it
// under a silent (no-restart) reset would break every image the running app
// has not loaded yet. Guarded by the state lock.
static NSString *paktaLaunchVersion = nil;

// JS and the bridge-free cold-start engine use different RCTPakta instances,
// but they must still share one download per target hash. Without this
// process-wide registry two NSURLSessionDownloadTasks race over the same
// archive path and the later unzip can delete the first task's valid output.
static NSMutableDictionary<NSString *, NSMutableDictionary *> *PaktaInFlightDownloads(void) {
    static NSMutableDictionary<NSString *, NSMutableDictionary *> *downloads;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        downloads = [NSMutableDictionary dictionary];
    });
    return downloads;
}

typedef NS_ENUM(NSInteger, PaktaDownloadRegistration) {
    PaktaDownloadRegistrationOwner,
    PaktaDownloadRegistrationJoined,
    PaktaDownloadRegistrationDeferred,
};

static PaktaDownloadRegistration PaktaRegisterDownload(
    NSString *hash,
    NSInteger type,
    NSTimeInterval deadlineUptime,
    void (^callback)(NSError *),
    void (^progress)(long long, long long),
    void (^deferredStart)(void)
) {
    NSMutableDictionary *downloads = PaktaInFlightDownloads();
    @synchronized (downloads) {
        NSMutableDictionary *entry = downloads[hash];
        if (entry != nil) {
            if ([entry[@"type"] integerValue] == type) {
                NSTimeInterval ownerDeadline = [entry[@"deadlineUptime"] doubleValue];
                // A caller with substantially more time must not inherit an
                // owner's nearly-exhausted timeout: it observes the current
                // transfer and restarts after the owner settles (the
                // completion-marker preflight makes a successful owner free).
                // The comparison is on remaining budget, not on the absolute
                // deadline: a JS caller always computes now+600 a few seconds
                // after the owner did, so a strict `>` would defer every
                // second caller and turn the shared download back into
                // serialized re-downloads. Only a genuinely starved owner
                // (less than half the newcomer's budget left) defers.
                const NSTimeInterval now = PaktaMonotonicNow();
                if (2 * (ownerDeadline - now) < (deadlineUptime - now)) {
                    if (progress != nil) {
                        [entry[@"progress"] addObject:[progress copy]];
                    }
                    [entry[@"deferred"] addObject:[deferredStart copy]];
                    return PaktaDownloadRegistrationDeferred;
                }
                [entry[@"callbacks"] addObject:[callback copy]];
                if (progress != nil) {
                    [entry[@"progress"] addObject:[progress copy]];
                }
                return PaktaDownloadRegistrationJoined;
            }
            // A diff failure must not settle a joined full request. Queue the
            // different artifact type behind the owner; once restarted it
            // registers normally (and re-checks the completion marker).
            if (progress != nil) {
                // The artifact type differs, but it still installs the same
                // target hash. Keep the waiting JS UI moving while its own
                // transfer is queued behind the current owner.
                [entry[@"progress"] addObject:[progress copy]];
            }
            [entry[@"deferred"] addObject:[deferredStart copy]];
            return PaktaDownloadRegistrationDeferred;
        }
        NSMutableArray *progressHandlers = [NSMutableArray array];
        if (progress != nil) {
            [progressHandlers addObject:[progress copy]];
        }
        downloads[hash] = [@{
            @"type": @(type),
            @"deadlineUptime": @(deadlineUptime),
            @"callbacks": [NSMutableArray arrayWithObject:[callback copy]],
            @"progress": progressHandlers,
            @"deferred": [NSMutableArray array],
        } mutableCopy];
        return PaktaDownloadRegistrationOwner;
    }
}

static void PaktaReportDownloadProgress(
    NSString *hash, long long received, long long total
) {
    NSMutableDictionary *downloads = PaktaInFlightDownloads();
    NSArray *handlers = nil;
    @synchronized (downloads) {
        handlers = [downloads[hash][@"progress"] copy];
    }
    for (id value in handlers) {
        void (^handler)(long long, long long) =
            (void (^)(long long, long long))value;
        handler(received, total);
    }
}

static void PaktaFinishDownload(NSString *hash, NSError *error) {
    NSMutableDictionary *downloads = PaktaInFlightDownloads();
    NSArray *callbacks = nil;
    NSArray *deferred = nil;
    @synchronized (downloads) {
        callbacks = [downloads[hash][@"callbacks"] copy];
        deferred = [downloads[hash][@"deferred"] copy];
        [downloads removeObjectForKey:hash];
    }
    // Establish the next (different-type) owner before waking the completed
    // owner's callbacks; otherwise its strategy loop could race the waiter.
    for (id value in deferred) {
        void (^start)(void) = (void (^)(void))value;
        start();
    }
    for (id value in callbacks) {
        void (^callback)(NSError *) = (void (^)(NSError *))value;
        callback(error);
    }
}

// Serializes every read-modify-write of the persisted update state. The state
// machine itself is a pure function (state_core), but callers run on different
// threads (main thread bundleURL, module method queue, _fileQueue), so the
// read→transform→write sequence must be atomic to avoid e.g. markSuccess being
// overwritten by a concurrent bundleURL and the version being rolled back.
static os_unfair_lock paktaStateLock = OS_UNFAIR_LOCK_INIT;

static void PaktaWithStateLock(void (NS_NOESCAPE ^block)(void)) {
#if DEBUG
    // Not re-entrant: a nested acquisition deadlocks in release, so catch it
    // where it is written.
    os_unfair_lock_assert_not_owner(&paktaStateLock);
#endif
    os_unfair_lock_lock(&paktaStateLock);
    @try {
        block();
    } @finally {
        os_unfair_lock_unlock(&paktaStateLock);
    }
}

static std::string PaktaToStdString(NSString *value) {
    if (value == nil) {
        return std::string();
    }
    return std::string([value UTF8String]);
}

static NSError *PaktaNSErrorFromStatus(const pakta::patch::Status &status) {
    return [NSError errorWithDomain:PaktaErrorDomain
                               code:-1
                           userInfo:@{
                               NSLocalizedDescriptionKey: [NSString stringWithUTF8String:status.message.c_str()],
                               PaktaErrorCodeKey: PaktaCode(pakta::error_codes::kPatchFailed),
                           }];
}

static NSUserDefaults *PaktaDefaults(void) {
    return [NSUserDefaults standardUserDefaults];
}

static NSString *PaktaFromStdString(const std::string &value) {
    if (value.empty()) {
        return nil;
    }
    return [NSString stringWithUTF8String:value.c_str()];
}

static void PaktaSetNullableString(NSUserDefaults *defaults, NSString *key, NSString *value) {
    if (value != nil) {
        [defaults setObject:value forKey:key];
    } else {
        [defaults removeObjectForKey:key];
    }
}

static NSString *PaktaHashInfoKey(NSString *hash) {
    return [keyHashInfo stringByAppendingString:hash ?: @""];
}

static void PaktaClearVersionScopedState(NSUserDefaults *defaults, BOOL reset) {
    [defaults removeObjectForKey:keyFirstLoadMarked];
    [defaults removeObjectForKey:keyNativeCheckCache];
    if (reset) {
        [defaults removeObjectForKey:KeyPackageUpdatedMarked];
    }
    for (NSString *key in [defaults dictionaryRepresentation].allKeys) {
        if ([key hasPrefix:keyHashInfo]) {
            [defaults removeObjectForKey:key];
        }
    }
}

static NSString *PaktaOptionString(NSDictionary *options, NSString *key) {
    return [RCTConvert NSString:options[key]];
}

static BOOL PaktaStringIsBlank(NSString *value) {
    if (value == nil || [value isKindOfClass:[NSNull class]]) {
        return YES;
    }
    return [[value stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]] length] == 0;
}

// Server-provided identifiers (hash/originHash) are used as child names under
// the download root; anything that could resolve outside of it (path
// separators, "..", ".") must be rejected before touching the filesystem.
static BOOL PaktaIsSafePathComponent(NSString *value) {
    if (PaktaStringIsBlank(value)) {
        return NO;
    }
    if ([value isEqualToString:@"."] || [value isEqualToString:@".."]) {
        return NO;
    }
    if ([value containsString:@"/"] || [value containsString:@"\\"]) {
        return NO;
    }
    if ([value rangeOfString:@"\0"].location != NSNotFound) {
        return NO;
    }
    return YES;
}

static void PaktaRejectError(RCTPromiseRejectBlock reject, NSError *error) {
    // Prefer the stable cross-platform code (error_codes.h); fall back to the
    // numeric NSError code for system errors that were not classified.
    NSString *code = error.userInfo[PaktaErrorCodeKey];
    if (code == nil) {
        code = [NSString stringWithFormat:@"%ld", (long)error.code];
    }
    reject(code, error.localizedDescription, error);
}

static NSError *PaktaErrorWithCode(const char *code, NSString *message) {
    return [NSError errorWithDomain:PaktaErrorDomain
                               code:-1
                           userInfo:@{
                               NSLocalizedDescriptionKey: message ?: @"unknown error",
                               PaktaErrorCodeKey: PaktaCode(code),
                           }];
}

static BOOL PaktaJsonIsAbsent(id value) {
    return value == nil || [value isKindOfClass:[NSNull class]];
}

// Builds the patch-core manifest from a parsed __diff.json. Every field is
// type-checked: this runs inside a GCD block on _fileQueue, where the
// unrecognized-selector exception a `copies` array or a numeric `from` would
// raise takes the whole app down (and trips the crash rescue) instead of
// failing the patch. NO with `reason` set for a malformed manifest.
static BOOL PaktaPatchManifestFromJson(NSDictionary *json,
                                       pakta::patch::PatchManifest *manifest,
                                       NSString **reason) {
    id copies = json[@"copies"];
    if (!PaktaJsonIsAbsent(copies)) {
        if (![copies isKindOfClass:[NSDictionary class]]) {
            *reason = @"patch manifest: copies is not an object";
            return NO;
        }
        // Content checksum per copy target ("copiesCrc", pdiff manifests
        // from CLI >= 1.0.0). The patch core verifies the copy source
        // against it and fails the patch on mismatch, so the JS strategy
        // chain falls back to the full package instead of copying drifted
        // bytes from a rebuilt binary.
        NSDictionary *copiesCrc = json[@"copiesCrc"];
        if (![copiesCrc isKindOfClass:[NSDictionary class]]) {
            copiesCrc = nil;
        }
        for (id to in (NSDictionary *)copies) {
            id from = ((NSDictionary *)copies)[to];
            if (![to isKindOfClass:[NSString class]] || ![from isKindOfClass:[NSString class]]) {
                *reason = @"patch manifest: copies entry is not a string";
                return NO;
            }
            if ([from length] == 0) {
                from = to;
            }
            pakta::patch::CopyOperation operation;
            operation.from = PaktaToStdString(from);
            operation.to = PaktaToStdString(to);
            NSNumber *expectedCrc = copiesCrc[to];
            if ([expectedCrc isKindOfClass:[NSNumber class]]) {
                operation.has_expected_crc = true;
                operation.expected_crc = (uint32_t)[expectedCrc unsignedLongLongValue];
            }
            manifest->copies.push_back(operation);
        }
    }

    // The CLI emits `deletes` as an object keyed by path (Android reads its
    // keys); a plain array of paths is accepted as well, like Harmony.
    id deletes = json[@"deletes"];
    if (!PaktaJsonIsAbsent(deletes)) {
        if (![deletes isKindOfClass:[NSDictionary class]] && ![deletes isKindOfClass:[NSArray class]]) {
            *reason = @"patch manifest: deletes is not an object or array";
            return NO;
        }
        for (id path in deletes) {
            if (![path isKindOfClass:[NSString class]]) {
                *reason = @"patch manifest: deletes entry is not a string";
                return NO;
            }
            manifest->deletes.push_back(PaktaToStdString(path));
        }
    }
    return YES;
}

// Binary identity under the prefixed key, or — until the first state write
// migrates it — the value an earlier SDK left under the unprefixed one, so an
// installed update survives the SDK upgrade instead of reading as a rebuilt
// binary.
static NSString *PaktaBinaryIdentityValue(NSUserDefaults *defaults, NSString *key, NSString *legacyKey) {
    return [defaults stringForKey:key] ?: [defaults stringForKey:legacyKey];
}

static pakta::state::State PaktaStateFromDefaults(NSUserDefaults *defaults) {
    pakta::state::State state;
    state.package_version = PaktaToStdString(
        PaktaBinaryIdentityValue(defaults, paramPackageVersion, legacyParamPackageVersion));
    state.build_time = PaktaToStdString(
        PaktaBinaryIdentityValue(defaults, paramBuildTime, legacyParamBuildTime));
    NSDictionary *paktaInfo = [defaults dictionaryForKey:keyPaktaInfo];
    if (paktaInfo != nil) {
        state.current_version = PaktaToStdString(paktaInfo[paramCurrentVersion]);
        state.last_version = PaktaToStdString(paktaInfo[paramLastVersion]);
        state.first_time = [paktaInfo[paramIsFirstTime] boolValue];
        id firstLoadOk = paktaInfo[paramIsFirstLoadOk];
        state.first_time_ok = firstLoadOk == nil ? true : [firstLoadOk boolValue];
    }
    state.rolled_back_version = PaktaToStdString([defaults stringForKey:keyRolledBackMarked]);
    return state;
}

static void PaktaApplyStateToDefaults(NSUserDefaults *defaults, const pakta::state::State &state) {
    PaktaSetNullableString(defaults, paramPackageVersion, PaktaFromStdString(state.package_version));
    PaktaSetNullableString(defaults, paramBuildTime, PaktaFromStdString(state.build_time));
    // One-time migration: once the prefixed keys hold the identity, the
    // legacy ones are retired so a host-app write there is never read again.
    [defaults removeObjectForKey:legacyParamPackageVersion];
    [defaults removeObjectForKey:legacyParamBuildTime];

    BOOL hasPaktaInfo = !state.current_version.empty() || !state.last_version.empty() || state.first_time || !state.first_time_ok;
    if (hasPaktaInfo) {
        NSMutableDictionary *newInfo = [[NSMutableDictionary alloc] init];
        if (!state.current_version.empty()) {
            newInfo[paramCurrentVersion] = PaktaFromStdString(state.current_version);
        }
        if (!state.last_version.empty()) {
            newInfo[paramLastVersion] = PaktaFromStdString(state.last_version);
        }
        newInfo[paramIsFirstTime] = @(state.first_time);
        newInfo[paramIsFirstLoadOk] = @(state.first_time_ok);
        [defaults setObject:newInfo forKey:keyPaktaInfo];
    } else {
        [defaults removeObjectForKey:keyPaktaInfo];
    }

    PaktaSetNullableString(
        defaults,
        keyRolledBackMarked,
        PaktaFromStdString(state.rolled_back_version));
}

// Version switch without acquiring the state lock: the caller must already
// hold it. Lets the cold-start check commit its whole result (version info,
// switch, response cache) inside one lock acquisition, so resetToPackagedBundle
// can never interleave between the generation check and the writes.
static void PaktaSwitchVersionLocked(NSString *hash) {
    NSUserDefaults *defaults = PaktaDefaults();
    pakta::state::State next = pakta::state::SwitchVersion(
        PaktaStateFromDefaults(defaults),
        PaktaToStdString(hash)
    );
    PaktaApplyStateToDefaults(defaults, next);
    // Re-enable first-load consumption and rollback checks for the newly selected bundle.
    ignoreRollback = false;
}

