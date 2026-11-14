+ (NSURL *)bundleURL
{
    paktaIsUsingBundleUrl = true;
    NSString *launchRolledBackVersion = nil;
    @try {
        NSString *purgedVersion = nil;
        NSURL *resolvedURL = [RCTPakta resolveLaunchBundleURL:&launchRolledBackVersion
                                                purgedVersion:&purgedVersion];
#if TARGET_OS_TV && !DEBUG
        // tvOS deleted the installed version while the app was not running.
        // The app is expected to be online: block the launch on a native
        // round that reinstalls the latest version, instead of showing the
        // packaged bundle and jumping forward again on a later launch.
        if (purgedVersion != nil &&
            [RCTPaktaOrchestrator restorePurgedLaunch:purgedVersion
                                           rolledBack:launchRolledBackVersion]) {
            resolvedURL = [RCTPakta resolveLaunchBundleURL:&launchRolledBackVersion
                                             purgedVersion:&purgedVersion];
        }
#endif
        return resolvedURL ?: [RCTPakta binaryBundleURL];
    } @finally {
        // State corruption is exactly when the rescue path matters most. If
        // resolution throws before a snapshot exists, nil safely omits only
        // this launch's rollback guard instead of disabling the check.
        [RCTPaktaOrchestrator scheduleFromColdStart:launchRolledBackVersion];
    }
}

// Resolves the bundle to launch from the persisted state; nil means the
// packaged bundle. Consumes the launch's one-shot state (first_time), so a
// second call is only valid after something re-armed it (a switchVersion).
// purgedVersion is set on tvOS when the installed version's files are gone.
+ (NSURL *)resolveLaunchBundleURL:(NSString **)launchRolledBackVersionOut
                    purgedVersion:(NSString **)purgedVersionOut
{
    __block NSURL *resolvedURL = nil;
    __block NSString *launchRolledBackVersion = nil;
    __block NSString *purgedVersion = nil;
    @try {
        PaktaWithStateLock(^{
            NSUserDefaults *defaults = PaktaDefaults();

        NSString *curPackageVersion = [RCTPakta packageVersion];
        NSString *curBuildTime = [RCTPakta buildTime];
        NSString *curChannel = [RCTPakta channel];
        NSString *previousChannel = [defaults stringForKey:keyBinaryChannel];

        pakta::state::State state = PaktaStateFromDefaults(defaults);
        pakta::state::BinaryVersionSyncResult sync = pakta::state::SyncBinaryVersion(
            state,
            PaktaToStdString(curPackageVersion),
            PaktaToStdString(curBuildTime)
        );
        BOOL channelChanged = previousChannel != nil && ![previousChannel isEqualToString:curChannel];
        if (channelChanged) {
            // 渠道是安装包身份的一部分。覆盖安装另一渠道时撤销热更状态、
            // 回滚标记和响应缓存，但保留 uuid、nativeConfig 等安装级数据。
            state.package_version = PaktaToStdString(curPackageVersion);
            state.build_time = PaktaToStdString(curBuildTime);
            state.current_version.clear();
            state.last_version.clear();
            state.first_time = false;
            state.first_time_ok = true;
            state.rolled_back_version.clear();
            paktaResetGeneration.fetch_add(1);
        } else if (sync.changed) {
            PaktaClearVersionScopedState(defaults, NO);
            [defaults setObject:@(YES) forKey:KeyPackageUpdatedMarked];
            state = sync.state;
            PaktaApplyStateToDefaults(defaults, state);
            [defaults setObject:curChannel forKey:keyBinaryChannel];
        } else if (previousChannel == nil) {
            [defaults setObject:curChannel forKey:keyBinaryChannel];
        }
        if (channelChanged) {
            PaktaClearVersionScopedState(defaults, NO);
            [defaults setObject:@(YES) forKey:KeyPackageUpdatedMarked];
            PaktaApplyStateToDefaults(defaults, state);
            [defaults setObject:curChannel forKey:keyBinaryChannel];
        }

        if (!state.current_version.empty()) {
            std::string const versionBeforeLaunch = state.current_version;
            pakta::state::LaunchDecision decision = pakta::state::ResolveLaunchState(
                state,
                ignoreRollback.load(),
                true
            );
            state = decision.state;

            if (decision.did_rollback) {
                // The crash-protection rollback: the new version never called
                // markSuccess. Keep this visible in release logs.
                RCTLogWarn(@"RCTPakta -- version %@ was not marked as successful, rolled back to %@",
                    PaktaFromStdString(versionBeforeLaunch),
                    PaktaFromStdString(state.current_version));
            }
            if (decision.did_rollback || decision.consumed_first_time) {
                PaktaApplyStateToDefaults(defaults, state);
            }
            if (decision.consumed_first_time) {
                // bundleURL may be called many times, ignore rollbacks before process restarted again.
                ignoreRollback = true;
                [defaults setObject:@(YES) forKey:keyFirstLoadMarked];
            }

            NSString *loadVersion = PaktaFromStdString(decision.load_version);
            NSString *downloadDir = [RCTPakta downloadDir];
            // Guard the rollback chain against cycles: a corrupted state
            // returning an already-visited version would otherwise spin this
            // loop forever during startup (Android has the same guard).
            NSMutableSet<NSString *> *visitedVersions = [NSMutableSet set];
            while (loadVersion.length && ![visitedVersions containsObject:loadVersion]) {
                [visitedVersions addObject:loadVersion];
                NSString *bundlePath = [[downloadDir stringByAppendingPathComponent:loadVersion] stringByAppendingPathComponent:BUNDLE_FILE_NAME];
                if ([[NSFileManager defaultManager] fileExistsAtPath:bundlePath isDirectory:NULL]) {
                    paktaLaunchVersion = loadVersion;
                    resolvedURL = [NSURL fileURLWithPath:bundlePath];
                    break;
                } else {
#if TARGET_OS_TV
                    // Caches is purgeable on tvOS: a missing bundle is the OS
                    // reclaiming space, not a bad release. Everything under
                    // rctpakta went with it, so walking back to last_version
                    // is pointless, and a rollback mark would make this
                    // launch's check refuse to reinstall the version.
                    RCTLogWarn(@"RCTPakta -- bundle version %@ was purged by the system", loadVersion);
                    purgedVersion = loadVersion;
                    state = pakta::state::ForgetPurgedVersions(state);
                    PaktaApplyStateToDefaults(defaults, state);
                    if (decision.consumed_first_time) {
                        // The first load being consumed never happens: the
                        // packaged bundle must not report isFirstTime.
                        ignoreRollback = false;
                        [defaults removeObjectForKey:keyFirstLoadMarked];
                    }
                    break;
#else
                    RCTLogError(@"RCTPakta -- bundle version %@ not found, rolling back", loadVersion);
                    state = pakta::state::Rollback(state);
                    PaktaApplyStateToDefaults(defaults, state);
                    loadVersion = PaktaFromStdString(state.current_version);
#endif
                }
            }
        }
        // Capture before constantsToExport consumes this one-shot marker.
        // The delayed native check must never forceBoot the version that this
        // launch just rolled back.
            launchRolledBackVersion = PaktaFromStdString(state.rolled_back_version);
        });
    } @finally {
        *launchRolledBackVersionOut = launchRolledBackVersion;
        *purgedVersionOut = purgedVersion;
    }
    return resolvedURL;
}

+ (NSString *) rollback {
    __block NSString *currentVersion = nil;
    PaktaWithStateLock(^{
        NSUserDefaults *defaults = PaktaDefaults();
        pakta::state::State state = pakta::state::Rollback(PaktaStateFromDefaults(defaults));
        PaktaApplyStateToDefaults(defaults, state);
        currentVersion = PaktaFromStdString(state.current_version);
    });
    return currentVersion;
}

+ (void)configure:(NSDictionary<NSString *, id> *)options
       completion:(RCTPaktaNativeConfigurationCompletion)completion
{
    NSError *validationError = nil;
    // Snapshot nested mutable caller values before crossing a queue boundary.
    NSString *config = RCTPaktaNormalizeNativeConfig(options, &validationError);
    static dispatch_queue_t configQueue;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        configQueue = dispatch_queue_create("cn.reactnative.pakta.host-config", DISPATCH_QUEUE_SERIAL);
    });
    dispatch_async(configQueue, ^{
        NSError *failure = validationError;
        if (config != nil) {
            @try {
                [RCTPaktaOrchestrator persistConfiguration:config];
            } @catch (NSException *exception) {
                failure = PaktaErrorWithCode(pakta::error_codes::kFileOperationFailed,
                    exception.reason ?: @"Native configuration failed");
            }
        }
        if (completion != nil) {
            dispatch_async(dispatch_get_main_queue(), ^{
                completion(failure);
            });
        }
    });
}

+ (void)checkAndUpdateWithCompletion:(RCTPaktaNativeUpdateCompletion)completion
{
    static dispatch_queue_t hostQueue;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        hostQueue = dispatch_queue_create("cn.reactnative.pakta.host-check", DISPATCH_QUEUE_SERIAL);
    });
    dispatch_async(hostQueue, ^{
        NSDictionary *result;
        @try {
            result = [RCTPaktaOrchestrator checkAndUpdate];
        } @catch (NSException *exception) {
            RCTLogWarn(@"RCTPakta -- native host check failed: %@", exception.reason);
            result = PaktaHostResult(@"failed", @"internal_error", nil, NO);
        }
        if (completion != nil) {
            NSDictionary *snapshot = [result copy];
            dispatch_async(dispatch_get_main_queue(), ^{
                completion(snapshot);
            });
        }
    });
}

