/**
 * [INPUT]: 依赖主编译单元的桥/下载类型、Foundation/dispatch、原子变量及共享状态/配置核
 * [OUTPUT]: 提供内部方法声明、单进程轮次/恢复窗口状态、崩溃救援处理和原始 bundle hash 缓存
 * [POS]: RCTPakta.mm 的私有协作契约与进程级门闩；连接 Launch/Orchestrator/Installer，不扩展公共头
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
@interface RCTPakta ()
- (void)downloadUpdate:(PaktaType)type
               options:(NSDictionary *)options
              resolver:(RCTPromiseResolveBlock)resolve
              rejecter:(RCTPromiseRejectBlock)reject;
- (void)performUpdate:(PaktaType)type
              options:(NSDictionary *)options
             callback:(void (^)(NSError *error))callback;
- (NSError *)reloadBridgeWithReason:(NSString *)reason;
- (void)unzipDownloadedPackage:(NSString *)zipFilePath
                          hash:(NSString *)hash
                          type:(PaktaType)type
                    originHash:(NSString *)originHash
                      callback:(void (^)(NSError *error))callback;
- (void)finishDownloadedPackage:(NSString *)hash
                           type:(PaktaType)type
                     originHash:(NSString *)originHash
                       callback:(void (^)(NSError *error))callback;
- (void)applyPatchForHash:(NSString *)hash
                     type:(PaktaType)type
               fromBundle:(NSString *)bundleOrigin
                   source:(NSString *)sourceOrigin
                 callback:(void (^)(NSError *error))callback;
- (BOOL)switchVersion:(NSString *)hash error:(NSError **)error;
- (BOOL)ensureDirectoryExistsAtPath:(NSString *)path;
+ (void)excludeFromBackup:(NSString *)path;
- (void)unzipFileAtPath:(NSString *)path
          toDestination:(NSString *)destination
      completionHandler:(void (^)(NSError *error))completionHandler;
+ (NSString *)downloadDir;
+ (NSURL *)binaryBundleURL;
+ (NSString *)packageVersion;
+ (NSString *)buildTime;
+ (NSString *)channel;
@end

// Native cold-start update check (NATIVE_CHECKUPDATE_DESIGN §10): runs once
// per process, a few seconds after launch, entirely independent of the app
// bundle — this is what lets a bricked hot update be replaced on the next
// launch. Decisions come from cpp/update_flow_core; this class is IO glue.
@interface RCTPaktaOrchestrator : NSObject
+ (void)persistConfiguration:(NSString *)config;
+ (BOOL)hasRunnableConfig;
+ (NSDictionary *)checkAndUpdate;
+ (void)scheduleFromColdStart:(NSString *)launchRolledBackVersion;
#if TARGET_OS_TV && !DEBUG
+ (BOOL)restorePurgedLaunch:(NSString *)purgedVersion
                 rolledBack:(NSString *)launchRolledBackVersion;
#endif
+ (void)markJsCheckCompleted:(NSString *)config;
+ (void)startRoundWithDeadline:(NSTimeInterval)deadlineUptime;
+ (void)runOnce:(NSString *)launchRolledBackVersion deadline:(NSTimeInterval)deadlineUptime;
+ (void)runRescueWithDeadline:(NSTimeInterval)deadlineUptime;
+ (BOOL)commitRoundWithGeneration:(uint64_t)generation
                         hashInfo:(NSDictionary *)hashInfoEntry
                         activate:(NSString *)hashToActivate
                     responseText:(NSString *)responseText
                          request:(NSString *)requestBody
                           config:(NSString *)configJson
                       responseAt:(long long)responseAtSeconds
                        activated:(BOOL *)activatedOut;
@end

// One round per process, whoever starts it first — the delayed cold-start
// path or the crash-rescue thread (§11.3). The semaphore lets the rescue
// wait out an in-flight round instead of racing it.
static std::atomic<bool> paktaRoundStarted{false};
static std::atomic<bool> paktaRoundCompleted{false};
// Flipped the moment a crash is being held. JS is dead from that point on,
// so there is no second decision maker: the round force-activates whatever
// it downloads (§11.3).
static std::atomic<bool> paktaCrashRescueActive{false};
static std::atomic<bool> paktaRescueAttempted{false};
// Set when this process's round is the tvOS purged-version restore.
static std::atomic<bool> paktaPurgeRestoreActive{false};
// True while +bundleURL waits for that restore. Only then may the round
// activate what it downloads on its own (JS has not started to decide), since
// the launch resolves the bundle again afterwards. Closed once the wait ends,
// timeout or not; guarded by the state lock that every activation commits
// under, so a commit lands either before the close (and launches) or after it
// (and is left to JS) — never selected behind the packaged bundle's back.
static bool paktaPurgeRestoreWindowOpen = false;
static dispatch_semaphore_t paktaRoundDone;
static NSString *paktaLaunchRolledBackForRescue = nil;
// A version this process downloaded but left for JS to activate. If the
// process then crashes, JS will never activate it — the crash handler
// activates it directly (bounded local work, no network). The generation is
// the one the round committed under: a reset that lands afterwards bumps it,
// and the late activation must lose to that reset exactly like the round
// itself would. Guarded by @synchronized (RCTPaktaOrchestrator class).
static NSString *paktaUnactivatedHash = nil;
static uint64_t paktaUnactivatedGeneration = 0;
static NSUncaughtExceptionHandler *paktaPreviousExceptionHandler = NULL;
// ≈ process start: scheduleFromColdStart runs during the first bundleURL.
static NSTimeInterval paktaProcessAnchorUptime = 0;
// Config JSON for which JS reported a completed check in this process
// (markJsCheckCompleted). Process-scoped by design. Guarded by
// @synchronized (RCTPaktaOrchestrator class).
static NSString *paktaJsCompletedConfig = nil;
// The group supplements (rather than consumes) the crash-rescue semaphore.
static dispatch_group_t paktaHostRoundGroup;
static std::atomic<bool> paktaNativeCheckReady{false};
static NSDictionary *paktaHostRoundResult = nil;
static NSString *paktaHostRoundConfig = nil;
static uint64_t paktaHostRoundGeneration = 0;
static std::atomic<uint64_t> paktaNativeConfigGeneration{0};
static uint64_t paktaHostRoundConfigGeneration = 0;

static const NSTimeInterval kPaktaRescueTriggerUptime = 60;
static const NSTimeInterval kPaktaRescueBudgetBackgroundThread = 10;
// A held main thread freezes UI teardown; stay well under the watchdog.
static const NSTimeInterval kPaktaRescueBudgetMainThread = 3.5;
// The purged-version restore blocks +bundleURL, usually inside
// application:didFinishLaunching: — stay clear of the launch watchdog.
static const NSTimeInterval kPaktaPurgeRestoreBudget = 12;

static void PaktaMaybeHoldForRescue(void) {
    // Once per process; a second crashing thread passes straight through
    // instead of waiting behind the first (§11.3: prefer under-rescuing over
    // wedging the teardown).
    bool expected = false;
    if (!paktaRescueAttempted.compare_exchange_strong(expected, true)) {
        return;
    }
    NSTimeInterval uptime = PaktaMonotonicNow() - paktaProcessAnchorUptime;
    bool roundInFlight = paktaRoundStarted.load() && !paktaRoundCompleted.load();
    // Early crashes are the brick signature; a crash with an in-flight round
    // is worth finishing regardless of uptime. Everything else is an ordinary
    // crash whose UX must not be delayed.
    if (uptime >= kPaktaRescueTriggerUptime && !roundInFlight) {
        return;
    }
    NSTimeInterval budget = [NSThread isMainThread]
        ? kPaktaRescueBudgetMainThread
        : kPaktaRescueBudgetBackgroundThread;
    NSTimeInterval deadline = PaktaMonotonicNow() + budget;
    NSLog(@"RCTPakta -- crash rescue: holding process for up to %.1fs "
          @"(uptime %.1fs)", budget, uptime);

    // The rescue runs on its own queue and the dying thread only waits with a
    // hard timeout: even a deadlocked rescue (a thread that died holding a
    // lock — uncaught ObjC exceptions skip @finally) can only delay the
    // process death, never prevent it.
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        @try {
            [RCTPaktaOrchestrator runRescueWithDeadline:deadline];
        } @catch (NSException *exception) {
            NSLog(@"RCTPakta -- crash rescue failed: %@", exception.reason);
        }
        dispatch_semaphore_signal(done);
    });
    if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW,
            (int64_t)(budget * NSEC_PER_SEC))) != 0) {
        NSLog(@"RCTPakta -- crash rescue: budget exhausted, letting go");
    }
}

// Crash-moment brick rescue (§11): when the app is dying of an uncaught
// exception during startup (RCTFatal raises NSException in release), the
// process is still alive and JS will never run again — a natural,
// false-positive-free window to finish the cold-start check. The previous
// handler (crash reporters chain the same way) always runs afterwards.
static void PaktaCrashRescueExceptionHandler(NSException *exception) {
    @try {
        PaktaMaybeHoldForRescue();
    } @catch (NSException *inner) {
        // The dying process owes the previous handler its turn no matter
        // what the rescue did.
    }
    if (paktaPreviousExceptionHandler != NULL) {
        paktaPreviousExceptionHandler(exception);
    }
}

static void PaktaInstallCrashRescueHandler(void) {
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        paktaPreviousExceptionHandler = NSGetUncaughtExceptionHandler();
        NSSetUncaughtExceptionHandler(&PaktaCrashRescueExceptionHandler);
    });
}

// Single-flight for the digest in PaktaBundleHashSync: the delayed cold-start
// round (utility queue) and JS getBundleHash (_fileQueue) can both miss the
// cache right after an install; the second caller waits for the first and
// then reads its cache entry instead of hashing the same multi-MB file twice.
static NSLock *PaktaBundleHashLock(void) {
    static NSLock *lock;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        lock = [NSLock new];
    });
    return lock;
}

static NSString *PaktaCachedBundleHash(NSUserDefaults *defaults, NSString *cachedPrefix) {
    NSString *cached = [defaults stringForKey:keyBundleHashCache];
    if ([cached hasPrefix:cachedPrefix]) {
        return [cached substringFromIndex:cachedPrefix.length];
    }
    return nil;
}

// Shared by the getBundleHash RCT method and the native cold-start check.
// Returns @"" when unknown. With computeIfMissing the sha256 of the embedded
// bundle is taken on a cache miss (once per install; blocking — call off the
// main thread). Without it only the cache is consulted: a crash rescue on
// the main thread has a 3.5s budget in total, and hashing a large bundle on
// a fresh install would spend all of it before the first request.
static NSString *PaktaBundleHashSync(BOOL computeIfMissing) {
    NSString *path = [[RCTPakta binaryBundleURL] path];
    if (path == nil) {
        return @"";
    }
    NSDictionary *attributes =
        [[NSFileManager defaultManager] attributesOfItemAtPath:path error:nil];
    if (attributes == nil) {
        return @"";
    }
    NSString *cacheKey = [NSString stringWithFormat:@"%@|%llu|%.0f",
        [RCTPakta packageVersion],
        attributes.fileSize,
        [attributes.fileModificationDate timeIntervalSince1970]];

    NSUserDefaults *defaults = PaktaDefaults();
    NSString *cachedPrefix = [cacheKey stringByAppendingString:@"|"];
    NSString *cached = PaktaCachedBundleHash(defaults, cachedPrefix);
    if (cached != nil) {
        return cached;
    }
    if (!computeIfMissing) {
        return @"";
    }

    NSLock *lock = PaktaBundleHashLock();
    [lock lock];
    @try {
        // The previous holder may have filled the cache while we waited.
        cached = PaktaCachedBundleHash(defaults, cachedPrefix);
        if (cached != nil) {
            return cached;
        }
        NSString *hash = PaktaFromStdString(
            pakta::digest::Sha256File(PaktaToStdString(path))) ?: @"";
        if (hash.length > 0) {
            [defaults setObject:[cachedPrefix stringByAppendingString:hash]
                         forKey:keyBundleHashCache];
        }
        return hash;
    } @finally {
        [lock unlock];
    }
}

