@implementation RCTPaktaOrchestrator

+ (void)persistConfiguration:(NSString *)config {
    PaktaWithStateLock(^{
        NSUserDefaults *defaults = PaktaDefaults();
        if ([defaults stringForKey:keyUuid].length == 0) {
            [defaults setObject:[NSUUID UUID].UUIDString forKey:keyUuid];
        }
        if (pakta::updateflow::ConfigsEquivalent(
            PaktaToStdString([defaults stringForKey:keyNativeConfig]), PaktaToStdString(config))) {
            return;
        }
        // The same generation protects reset and replacement of the request
        // identity/policy, including a late crash-rescue activation.
        paktaResetGeneration.fetch_add(1);
        paktaNativeConfigGeneration.fetch_add(1);
        [defaults setObject:config forKey:keyNativeConfig];
        [defaults removeObjectForKey:keyNativeCheckCache];
        [self markJsCheckCompleted:nil];
    });
    if (paktaNativeCheckReady.load() && [self hasRunnableConfig]) {
        PaktaInstallCrashRescueHandler();
    }
}

+ (BOOL)hasRunnableConfig {
    NSString *json = [PaktaDefaults() stringForKey:keyNativeConfig];
    return pakta::updateflow::ParseRunnableConfig(PaktaToStdString(json)).runnable();
}

// Process-wide round state, set up by whichever launch path needs a round
// first: the delayed cold-start check or the tvOS purged-version restore.
+ (void)prepareProcess:(NSString *)launchRolledBackVersion {
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        paktaRoundDone = dispatch_semaphore_create(0);
        paktaHostRoundGroup = dispatch_group_create();
        dispatch_group_enter(paktaHostRoundGroup);
        paktaProcessAnchorUptime = PaktaMonotonicNow();
        paktaLaunchRolledBackForRescue = [launchRolledBackVersion copy];
        paktaNativeCheckReady.store(true);
        // The crash-hold rescue shares the orchestrator's rollout gate: no
        // persisted config, no handler (§11.3).
        if ([self hasRunnableConfig]) {
            PaktaInstallCrashRescueHandler();
        }
    });
}

+ (void)scheduleFromColdStart:(NSString *)launchRolledBackVersion {
#if !DEBUG
    // Once per process; a few seconds of delay keeps the check away from the
    // cold-start critical path (§7 R5) — its result targets the NEXT launch.
    // Unless the previous process died mid-round (residual incomplete
    // marker), in which case every launch second counts (§11.4).
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        [self prepareProcess:launchRolledBackVersion];
        NSUserDefaults *defaults = PaktaDefaults();
        int64_t delaySeconds =
            [defaults objectForKey:keyNativeCheckIncomplete] != nil ? 0 : 5;
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, delaySeconds * NSEC_PER_SEC),
                       dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
            if ([self isJsCheckCompleted]) {
                // Not consuming the round: a later crash rescue may still
                // need it.
                NSLog(@"RCTPakta -- native check skipped: JS check completed in this process");
                return;
            }
            [self startRoundWithDeadline:0];
        });
    });
#endif
}

#if TARGET_OS_TV && !DEBUG
// Runs this process's round before the first bundle loads, blocking the
// caller for at most the remaining process launch budget. The state no longer has a
// current version, so the server answers with the latest version for the
// packaged bundle, and the round activates it while the restore window is
// open. Returns NO when no round can run; otherwise the caller must resolve
// the launch bundle again: it launches whatever was activated before the
// window closed, or the packaged bundle. The round stops at the same
// deadline, keeping a partial download for the next check to resume.
+ (BOOL)restorePurgedLaunch:(NSString *)purgedVersion
                 rolledBack:(NSString *)launchRolledBackVersion {
    [self prepareProcess:launchRolledBackVersion];
    if (![self hasRunnableConfig]) {
        RCTLogWarn(@"RCTPakta -- version %@ was purged and no native check is "
                   @"configured; launching the packaged bundle", purgedVersion);
        return NO;
    }
    if (!PaktaHasNetworkPath()) {
        RCTLogWarn(@"RCTPakta -- version %@ was purged and there is no network; "
                   @"launching the packaged bundle", purgedVersion);
        return NO;
    }
    NSTimeInterval budget = kPaktaPurgeRestoreBudget - PaktaProcessElapsed();
    if (budget < kPaktaPurgeRestoreMinimumBudget) {
        RCTLogWarn(@"RCTPakta -- version %@ was purged and the launch budget is "
                   @"spent; launching the packaged bundle", purgedVersion);
        return NO;
    }
    PaktaWithStateLock(^{
        paktaPurgeRestoreWindowOpen = true;
    });
    paktaPurgeRestoreActive.store(true);
    NSTimeInterval deadline = PaktaMonotonicNow() + budget;
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        [self startRoundWithDeadline:deadline];
        dispatch_semaphore_signal(done);
    });
    BOOL timedOut = dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW,
        (int64_t)(budget * NSEC_PER_SEC))) != 0;
    // The round's deadline does not bound a slow response (the request
    // timeout is an idle timeout) nor a version already on disk, so the close
    // is what stops a late activation — not the deadline.
    PaktaWithStateLock(^{
        paktaPurgeRestoreWindowOpen = false;
    });
    if (timedOut) {
        RCTLogWarn(@"RCTPakta -- purged version %@ restore timed out", purgedVersion);
    } else {
        NSDictionary *result = paktaHostRoundResult;
        RCTLogInfo(@"RCTPakta -- purged version %@ restore: %@ %@ %@", purgedVersion,
                   result[@"status"], result[@"reason"], result[@"hash"]);
    }
    return YES;
}
#endif

+ (NSDictionary *)checkAndUpdate {
#if DEBUG
    return PaktaHostResult(@"skipped", @"debug", nil, NO);
#else
    if (!paktaNativeCheckReady.load()) {
        return PaktaHostResult(@"skipped", @"not_initialized", nil, NO);
    }
    NSString *configJson = [PaktaDefaults() stringForKey:keyNativeConfig];
    const auto gate = pakta::updateflow::ParseRunnableConfig(PaktaToStdString(configJson));
    if (!gate.runnable()) {
        return PaktaHostResult(PaktaFromStdString(gate.status), PaktaFromStdString(gate.reason), nil, NO);
    }
    [self startRoundWithDeadline:0];
    // A group is broadcast-style. Sharing the rescue semaphore would let one
    // waiter consume the only signal and leave the other waiting forever.
    if (!paktaRoundStarted.load()) {
        return PaktaHostResult(@"skipped", @"config_changed", nil, NO);
    }
    dispatch_group_wait(paktaHostRoundGroup, DISPATCH_TIME_FOREVER);
    const std::string cancelled = pakta::updateflow::HostCancellation(
        PaktaToStdString(configJson), PaktaToStdString(paktaHostRoundConfig),
        PaktaToStdString([PaktaDefaults() stringForKey:keyNativeConfig]),
        paktaHostRoundConfigGeneration, paktaNativeConfigGeneration.load(),
        paktaHostRoundGeneration, paktaResetGeneration.load());
    if (!cancelled.empty()) {
        return PaktaHostResult(@"cancelled", PaktaFromStdString(cancelled), nil, NO);
    }
    return paktaHostRoundResult ?: PaktaHostResult(@"failed", @"internal_error", nil, NO);
#endif
}

+ (void)markJsCheckCompleted:(NSString *)config {
    @synchronized (RCTPaktaOrchestrator.class) {
        paktaJsCompletedConfig = [config copy];
    }
}

// True when JS already obtained a valid response in this process for the
// exact config the native round would use (§10.3): the delayed round is
// then a duplicate request. Only the scheduled round asks — the crash-rescue
// path still runs, JS is dead by then.
+ (BOOL)isJsCheckCompleted {
    NSString *jsConfig;
    @synchronized (RCTPaktaOrchestrator.class) {
        jsConfig = paktaJsCompletedConfig;
    }
    if (jsConfig == nil) {
        return NO;
    }
    NSString *persisted = [PaktaDefaults() stringForKey:keyNativeConfig];
    return pakta::updateflow::ConfigsEquivalent(PaktaToStdString(persisted), PaktaToStdString(jsConfig));
}

// Runs the process's single round on the calling thread if nobody has
// started it yet. deadlineUptime > 0 (crash rescue) caps every HTTP call and
// download phase to the remaining budget.
+ (void)startRoundWithDeadline:(NSTimeInterval)deadlineUptime {
    // Missing/disabled configuration is a preflight skip, not a used round.
    if (![self hasRunnableConfig]) {
        return;
    }
    bool expected = false;
    if (!paktaRoundStarted.compare_exchange_strong(expected, true)) {
        return;
    }
    @try {
        [self runOnce:paktaLaunchRolledBackForRescue deadline:deadlineUptime];
    } @catch (NSException *exception) {
        // The rescue path must never take the app down with it.
        RCTLogWarn(@"RCTPakta -- native check crashed: %@", exception.reason);
        paktaHostRoundResult = PaktaHostResult(@"failed", @"internal_error", nil, NO);
    } @finally {
        paktaRoundCompleted.store(true);
        dispatch_semaphore_signal(paktaRoundDone);
        dispatch_group_leave(paktaHostRoundGroup);
    }
}

// Crash-rescue entry (§11.3), called from the handler's worker queue while
// the uncaught-exception handler holds the dying process. Ensures this
// process's round runs to completion within the budget, then activates a
// downloaded-but-unactivated version if one exists — the last chance before
// the process is gone.
+ (void)runRescueWithDeadline:(NSTimeInterval)deadlineUptime {
    paktaCrashRescueActive.store(true);
    [self startRoundWithDeadline:deadlineUptime];
    if (paktaRoundStarted.load() && !paktaRoundCompleted.load()) {
        NSTimeInterval remaining = deadlineUptime - PaktaMonotonicNow();
        if (remaining > 0) {
            dispatch_semaphore_wait(paktaRoundDone, dispatch_time(DISPATCH_TIME_NOW,
                (int64_t)(remaining * NSEC_PER_SEC)));
        }
    }
    [self activatePendingVersion];
}

// The alert-strategy variant of the §10.7 hole: the round downloaded a fix
// but deferred activation to JS, and JS is now dead. Activation is local and
// bounded (a state switch under the commit lock).
+ (void)activatePendingVersion {
    NSString *hash = nil;
    uint64_t generation = 0;
    @synchronized (self) {
        hash = paktaUnactivatedHash;
        generation = paktaUnactivatedGeneration;
    }
    if (hash == nil) {
        return;
    }
    // Unlike Android's switchVersion, PaktaSwitchVersionLocked does not
    // validate the version directory; never point the next launch at bytes
    // that are gone (e.g. wiped by a reset whose generation bump we would
    // catch below anyway, or by cleanup).
    NSString *versionDir = [[RCTPakta downloadDir] stringByAppendingPathComponent:hash];
    if (!PaktaHasCompletedVersionAtPath(versionDir, hash)) {
        NSLog(@"RCTPakta -- crash rescue: version %@ no longer on disk, dropping activation", hash);
        return;
    }
    NSDictionary *hashInfoEntry = nil;
    NSString *existingInfo = [PaktaDefaults() stringForKey:PaktaHashInfoKey(hash)];
    NSData *existingData = [existingInfo dataUsingEncoding:NSUTF8StringEncoding];
    id parsed = existingData == nil ? nil :
        [NSJSONSerialization JSONObjectWithData:existingData options:0 error:nil];
    if ([parsed isKindOfClass:[NSDictionary class]]) {
        NSMutableDictionary *merged = [parsed mutableCopy];
        merged[@"crashRescue"] = @YES;
        hashInfoEntry = @{@"hash": hash, @"info": merged};
    }
    BOOL committed = [self commitRoundWithGeneration:generation
                                            hashInfo:hashInfoEntry
                                            activate:hash
                                        responseText:nil
                                             request:nil
                                              config:nil
                                          responseAt:0
                                           activated:NULL];
    if (committed) {
        @synchronized (self) {
            paktaUnactivatedHash = nil;
        }
        NSLog(@"RCTPakta -- crash rescue: activated downloaded version %@", hash);
    } else {
        NSLog(@"RCTPakta -- crash rescue: reset since download, dropping activation");
    }
}

// A bare module instance drives the existing download/patch pipeline without
// a bridge: the file queue is process-global and progress events are gated on
// hasListeners (never set without a bridge).
+ (RCTPakta *)engine {
    static RCTPakta *engine;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        engine = [[RCTPakta alloc] init];
    });
    return engine;
}
