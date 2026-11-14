/**
 * [INPUT]: 依赖内部职责片段、React Native 桥/重载、Downloader/NativeConfig、SSZipArchive、UIKit/defaults 与 patch/state/StepRound 共享核心
 * [OUTPUT]: 对外实现 RCTPakta 模块、bundleURL、下载/切包/回滚/重置/配置 API、版本绑定成功确认、进度事件、无 JS 冷启动检查/崩溃救援，以及无桥宿主面 configure/hasRunnableConfig/prepareProcess/scheduleFromColdStart/restorePurgedLaunch:rolledBack:/checkAndUpdate 与 commitRoundWithGeneration:activated: 代际外参
 * [POS]: Apple 唯一生产编译单元，内部片段共享原静态锁和文件队列；轮次策略委托共享 StepRound，RN 日志只携带源文件名
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
#import "RCTPakta.h"
#import "RCTPaktaNativeConfig.h"
#import "RCTPaktaDownloader.h"
#import "ZipArchive.h"
#include "../../cpp/patch_core/archive_limits.h"
#include "../../cpp/patch_core/archive_patch_core.h"
#include "../../cpp/patch_core/digest.h"
#include "../../cpp/patch_core/hbc_transform_wire.h"
#include "../../cpp/patch_core/install_record.h"
#include "../../cpp/patch_core/error_codes.h"
#include "../../cpp/patch_core/patch_core.h"
#include "../../cpp/patch_core/state_core.h"
#include "../../cpp/update_flow_core/flow_json.h"
#include "../../cpp/update_flow_core/update_flow_core.h"
#include "../../cpp/update_flow_core/native_round.h"
#include "../../cpp/update_flow_core/round_engine.h"
#include "../../cpp/update_flow_core/native_config.h"

#import <UIKit/UIKit.h>

// use_frameworks! 构建里 React 头文件只有 <React/…> 框架形式可见,引号形式的
// __has_include 会探测失败;漏掉这里会静默编入 [self.bridge reload] 兜底,而
// bridgeless 下 bridge 是 nil/代理,reload 变成无声 no-op(切版本后不重启)。
#if __has_include("RCTReloadCommand.h")
#import "RCTReloadCommand.h"
#define PAKTA_HAS_RELOAD_COMMAND 1
#elif __has_include(<React/RCTReloadCommand.h>)
#import <React/RCTReloadCommand.h>
#define PAKTA_HAS_RELOAD_COMMAND 1
#endif
#ifdef RCT_NEW_ARCH_ENABLED
#import "RCTPaktaSpec.h"
#endif

#import <React/RCTConvert.h>
#import <React/RCTLog.h>
// RN 日志只保留文件名，避免把开发机绝对构建路径写入原生产物。
#if RCTLOG_ENABLED
#undef _RCTLog
#define _RCTLog(lvl, ...) _RCTLogNativeInternal(lvl, __FILE_NAME__, __LINE__, __VA_ARGS__)
#endif
#import <objc/runtime.h>
#import <os/lock.h>

#include <atomic>
#include <sys/stat.h>

// Immutable host-facing snapshot; activated always means NEXT launch.
static NSDictionary *PaktaHostResult(NSString *status, NSString *reason,
                                    NSString *hash, BOOL activated) {
    return @{@"status": status, @"reason": reason ?: @"",
             @"hash": hash ?: @"", @"activated": @(activated)};
}

static NSString *const keyPaktaInfo = @"REACTNATIVECN_PAKTA_INFO_KEY";
// Binary identity (SyncBinaryVersion input). Prefixed like every other key:
// the unprefixed names collided with generic host-app/SDK defaults, and a
// foreign value there made every launch look like a rebuilt binary and wipe
// the installed update.
static NSString *const paramPackageVersion = @"REACTNATIVECN_PAKTA_PACKAGEVERSION";
static NSString *const paramBuildTime = @"REACTNATIVECN_PAKTA_BUILDTIME";
static NSString *const keyBinaryChannel = @"REACTNATIVECN_PAKTA_BINARY_CHANNEL";
// The unprefixed names earlier SDKs wrote. Read only as a fallback until the
// first state write migrates them (PaktaStateFromDefaults /
// PaktaApplyStateToDefaults).
static NSString *const legacyParamPackageVersion = @"packageVersion";
static NSString *const legacyParamBuildTime = @"buildTime";
static NSString *const paramLastVersion = @"lastVersion";
static NSString *const paramCurrentVersion = @"currentVersion";
static NSString *const paramIsFirstTime = @"isFirstTime";
static NSString *const paramIsFirstLoadOk = @"isFirstLoadOK";
static NSString *const keyUuid = @"REACTNATIVECN_PAKTA_UUID";
static NSString *const keyHashInfo = @"REACTNATIVECN_PAKTA_HASH_";
static NSString *const keyFirstLoadMarked = @"REACTNATIVECN_PAKTA_FIRSTLOADMARKED_KEY";
static NSString *const keyRolledBackMarked = @"REACTNATIVECN_PAKTA_ROLLEDBACKMARKED_KEY";
static NSString *const KeyPackageUpdatedMarked = @"REACTNATIVECN_PAKTA_ISPACKAGEUPDATEDMARKED_KEY";
// bundleHash cache: "<cacheKey>|<sha256hex>" where cacheKey identifies the
// installed binary (packageVersion + embedded bundle size + mtime). Recomputed
// only when the key changes, i.e. once per install.
static NSString *const keyBundleHashCache = @"REACTNATIVECN_PAKTA_BUNDLEHASH_KEY";
// Raw JSON persisted by JS (syncNativeConfig) for the native cold-start
// update check; parsed on read by the orchestrator. Absent = check disabled.
static NSString *const keyNativeConfig = @"REACTNATIVECN_PAKTA_NATIVE_CONFIG_KEY";
// Raw response cache written by the native cold-start check for the JS side
// to reuse (§10.3), scoped to the request and config that produced it.
static NSString *const keyNativeCheckCache = @"REACTNATIVECN_PAKTA_NATIVE_CHECK_RESP_KEY";
// Set when a native check round starts, cleared when it ends (§11.4). Residue
// on the next launch means the previous process died mid-round (a crash
// rescue was truncated): that launch resumes immediately instead of waiting.
static NSString *const keyNativeCheckIncomplete = @"REACTNATIVECN_PAKTA_NATIVE_CHECK_INCOMPLETE_KEY";
static NSString *const PaktaErrorDomain = @"cn.reactnative.pakta";

// file def
static NSString * const BUNDLE_FILE_NAME = @"index.bundlejs";
static NSString * const SOURCE_PATCH_NAME = @"__diff.json";
static NSString * const BUNDLE_PATCH_NAME = @"index.bundlejs.patch";
#define VERSION_COMPLETE_FILE_NAME_LITERAL ".pakta-complete"
static NSString * const VERSION_COMPLETE_FILE_NAME = @VERSION_COMPLETE_FILE_NAME_LITERAL;

// error def — messages are human-readable; the stable cross-platform codes
// live in cpp/patch_core/error_codes.h and travel in PaktaErrorCodeKey.
static NSString * const ERROR_OPTIONS = @"options error";
static NSString * const ERROR_FILE_OPERATION = @"file operation error";
static NSString * const PaktaErrorCodeKey = @"PaktaErrorCode";

static NSString *PaktaCode(const char *code) {
    return [NSString stringWithUTF8String:code];
}

// cInfo.os label prefix; must match the JS side (core.ts) so the server
// buckets tvOS devices apart from iOS ones.
#if TARGET_OS_TV
static NSString * const PaktaOsName = @"tvos";
#else
static NSString * const PaktaOsName = @"ios";
#endif

// event def
static NSString * const EVENT_PROGRESS_DOWNLOAD = @"RCTPaktaDownloadProgress";
static NSString * const PARAM_PROGRESS_HASH = @"hash";
static NSString * const PARAM_PROGRESS_RECEIVED = @"received";
static NSString * const PARAM_PROGRESS_TOTAL = @"total";

static NSTimeInterval PaktaMonotonicNow(void) {
    return [NSProcessInfo processInfo].systemUptime;
}

static std::string PaktaToStdString(NSString *value);

#include "RCTPaktaInstallRecord.inc"
#include "RCTPaktaState.inc"
#include "RCTPaktaInternal.inc"
@implementation RCTPakta {
    dispatch_queue_t _fileQueue;
    bool hasListeners;
}

RCT_EXPORT_MODULE(RCTPakta);

#include "RCTPaktaLaunch.inc"
+ (BOOL)requiresMainQueueSetup
{
    return NO;
}

- (NSDictionary *)constantsToExport
{
    NSMutableDictionary *ret = [NSMutableDictionary new];
    PaktaWithStateLock(^{
        NSUserDefaults *defaults = PaktaDefaults();

        ret[@"downloadRootDir"] = [RCTPakta downloadDir];
        ret[@"packageVersion"] = [RCTPakta packageVersion];
        ret[@"buildTime"] = [RCTPakta buildTime];
        ret[@"channel"] = [RCTPakta channel];
        ret[@"rolledBackVersion"] = [defaults objectForKey:keyRolledBackMarked];
        ret[@"isFirstTime"] = [defaults objectForKey:keyFirstLoadMarked];
        ret[@"uuid"] = [defaults objectForKey:keyUuid];
        ret[@"isUsingBundleUrl"] = @(paktaIsUsingBundleUrl.load());
        // 原生 patch 内核可消费的 diff 轨道版本(2 = hdiffv2 轨道),
        // JS 随 checkUpdate 以 diffV 上报,服务端按能力门控下发
        ret[@"supportedDiffVersion"] = @(pakta::hbc::kSupportedDiffVersion);
        NSDictionary *paktaInfo = [defaults dictionaryForKey:keyPaktaInfo];
        NSString *currentVersion = [paktaInfo objectForKey:paramCurrentVersion];
        ret[@"currentVersion"] = currentVersion;
        if (currentVersion != nil) {
            ret[@"currentVersionInfo"] = [defaults objectForKey:PaktaHashInfoKey(currentVersion)];
            // bundleSha256 from the install record, for crash-report attribution.
            NSString *bundleSha256 = @"";
            if (PaktaIsSafePathComponent(currentVersion)) {
                NSDictionary *record = PaktaReadInstallRecord(
                    [[RCTPakta downloadDir] stringByAppendingPathComponent:currentVersion]);
                if ([record[@"bundleSha256"] isKindOfClass:[NSString class]]) {
                    bundleSha256 = record[@"bundleSha256"];
                }
            }
            ret[@"currentBundleSha256"] = bundleSha256;
        }

        if (ret[@"isFirstTime"]) {
            [defaults removeObjectForKey:keyFirstLoadMarked];
        }

        if (ret[@"rolledBackVersion"] != nil) {
            [defaults removeObjectForKey:keyRolledBackMarked];
            [self clearInvalidFiles];
        }

        if ([[defaults objectForKey:KeyPackageUpdatedMarked] boolValue]) {
            [defaults removeObjectForKey:KeyPackageUpdatedMarked];
            [self clearInvalidFiles];
        }
    });

    return ret;
}

- (instancetype)init
{
    self = [super init];
    if (self) {
        // One process-wide serial queue, not per-instance: a bridge reload can
        // briefly keep two RCTPakta instances alive, and destructive file work
        // (resetToPackagedBundle's full cleanup) must stay serialized with the
        // other instance's unzip/patch jobs.
        static dispatch_queue_t sharedFileQueue;
        static dispatch_once_t onceToken;
        dispatch_once(&onceToken, ^{
            sharedFileQueue = dispatch_queue_create("cn.reactnative.pakta.file", DISPATCH_QUEUE_SERIAL);
        });
        _fileQueue = sharedFileQueue;
    }
    return self;
}

RCT_EXPORT_METHOD(setUuid:(NSString *)uuid  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    if (PaktaStringIsBlank(uuid)) {
        PaktaRejectError(reject, PaktaErrorWithCode(pakta::error_codes::kInvalidOptions, ERROR_OPTIONS));
        return;
    }

    NSUserDefaults *defaults = PaktaDefaults();
    [defaults setObject:uuid forKey:keyUuid];
    resolve(@true);
}

RCT_EXPORT_METHOD(syncNativeConfig:(NSString *)config
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    // Provisioning for the native cold-start check (NATIVE_CHECKUPDATE_DESIGN
    // §10.1). Validate at write time: a corrupt config would otherwise
    // silently disable the native check forever with no signal.
    if (PaktaStringIsBlank(config)) {
        PaktaRejectError(reject, PaktaErrorWithCode(pakta::error_codes::kInvalidOptions, ERROR_OPTIONS));
        return;
    }
    NSData *data = [config dataUsingEncoding:NSUTF8StringEncoding];
    NSError *error = nil;
    id object = data == nil ? nil : [NSJSONSerialization JSONObjectWithData:data options:0 error:&error];
    if (![object isKindOfClass:[NSDictionary class]]) {
        PaktaRejectError(reject, PaktaErrorWithCode(
            pakta::error_codes::kInvalidOptions,
            error != nil ? error.localizedDescription : ERROR_OPTIONS));
        return;
    }
    @try {
        [RCTPaktaOrchestrator persistConfiguration:config];
        resolve(@true);
    } @catch (NSException *exception) {
        PaktaRejectError(reject, PaktaErrorWithCode(pakta::error_codes::kFileOperationFailed,
            exception.reason ?: @"Native configuration failed"));
    }
}

RCT_EXPORT_METHOD(getNativeCheckCache:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    resolve([PaktaDefaults() stringForKey:keyNativeCheckCache] ?: @"");
}

RCT_EXPORT_METHOD(markJsCheckCompleted:(NSString *)config
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    if (PaktaStringIsBlank(config)) {
        PaktaRejectError(reject, PaktaErrorWithCode(pakta::error_codes::kInvalidOptions, ERROR_OPTIONS));
        return;
    }
    [RCTPaktaOrchestrator markJsCheckCompleted:config];
    resolve(@true);
}

RCT_EXPORT_METHOD(setLocalHashInfo:(NSString *)hash
                  value:(NSString *)value resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    if (PaktaStringIsBlank(hash) || PaktaStringIsBlank(value)) {
        PaktaRejectError(reject, PaktaErrorWithCode(pakta::error_codes::kInvalidOptions, ERROR_OPTIONS));
        return;
    }

    NSData *data = [value dataUsingEncoding:NSUTF8StringEncoding];
    NSError *error = nil;
    id object = [NSJSONSerialization JSONObjectWithData:data options:0 error:&error];
    if (object && [object isKindOfClass:[NSDictionary class]]) {
        NSUserDefaults *defaults = PaktaDefaults();
        [defaults setObject:value forKey:PaktaHashInfoKey(hash)];

        resolve(@true);
    } else {
        PaktaRejectError(reject, PaktaErrorWithCode(
            pakta::error_codes::kInvalidHashInfo,
            error != nil ? error.localizedDescription : @"invalid json string"));
    }
}


RCT_EXPORT_METHOD(getLocalHashInfo:(NSString *)hash
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{

    NSUserDefaults *defaults = PaktaDefaults();
    resolve([defaults stringForKey:PaktaHashInfoKey(hash)]);
}

RCT_EXPORT_METHOD(downloadFullUpdate:(NSDictionary *)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    [self downloadUpdate:PaktaTypeFullDownload options:options resolver:resolve rejecter:reject];
}

RCT_EXPORT_METHOD(downloadPatchFromPackage:(NSDictionary *)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    [self downloadUpdate:PaktaTypePatchFromPackage options:options resolver:resolve rejecter:reject];
}

RCT_EXPORT_METHOD(downloadPatchFromPpk:(NSDictionary *)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    [self downloadUpdate:PaktaTypePatchFromPpk options:options resolver:resolve rejecter:reject];
}

RCT_EXPORT_METHOD(downloadAndInstallApk:(NSDictionary *)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    PaktaRejectError(reject, PaktaErrorWithCode(
        pakta::error_codes::kUnsupportedPlatform,
        @"downloadAndInstallApk is only supported on Android"));
}

RCT_EXPORT_METHOD(setNeedUpdate:(NSDictionary *)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    NSError *error = nil;
    if (![self switchVersion:PaktaOptionString(options, @"hash") error:&error]) {
        PaktaRejectError(reject, error);
        return;
    }

    resolve(@true);
}

RCT_EXPORT_METHOD(reloadUpdate:(NSDictionary *)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    NSError *error = nil;
    if (![self switchVersion:PaktaOptionString(options, @"hash") error:&error]) {
        PaktaRejectError(reject, error);
        return;
    }

    NSError *reloadError = [self reloadBridgeWithReason:@"pakta reloadUpdate"];
    if (reloadError != nil) {
        PaktaRejectError(reject, reloadError);
        return;
    }
    resolve(@true);
}

RCT_EXPORT_METHOD(restartApp:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    NSError *reloadError = [self reloadBridgeWithReason:@"pakta restartApp"];
    if (reloadError != nil) {
        PaktaRejectError(reject, reloadError);
        return;
    }
    resolve(@true);
}

RCT_EXPORT_METHOD(getBundleHash:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    // bundleHash = sha256 of the bundle embedded in the binary — the identity
    // of the binary itself, not of whatever hot update is currently running.
    // It must hash exactly the bytes pdiff patches from (binaryBundleURL, the
    // pdiff fromBundle). Lazily computed once per install, cached in defaults.
    // Never rejects: an empty string means "unknown" and the server falls back
    // to the buildTime heuristic.
#if DEBUG
    // Metro serves the bundle in debug; the embedded file (if any) is not what
    // is running. Mirrors the dev behaviour of buildTime.
    resolve(@"");
#else
    dispatch_async(_fileQueue, ^{
        resolve(PaktaBundleHashSync(YES));
    });
#endif
}

RCT_EXPORT_METHOD(markSuccess:(NSString *)expectedHash
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    #if DEBUG
    resolve(@true);
    #else

    __block BOOL accepted = NO;
    // Failures surface as MARK_SUCCESS_FAILED like on Android, so per-code
    // telemetry is not blind to this transition on iOS.
    @try {
        PaktaWithStateLock(^{
            // expectedHash 必须同时对应本进程实际解析并加载的 bundle；只看持久化
            // currentVersion 会把冷启动检查在 JS 初始化前切换的版本误报成功。
            if (paktaLaunchVersion == nil || ![expectedHash isEqualToString:paktaLaunchVersion]) {
                return;
            }
            NSUserDefaults *defaults = PaktaDefaults();
            pakta::state::MarkSuccessResult result =
                pakta::state::MarkSuccess(
                    PaktaStateFromDefaults(defaults),
                    PaktaToStdString(expectedHash));
            accepted = result.accepted;
            if (!accepted) {
                return;
            }
            if (!result.stale_version_to_delete.empty()) {
                [defaults removeObjectForKey:PaktaHashInfoKey(PaktaFromStdString(result.stale_version_to_delete))];
            }
            PaktaApplyStateToDefaults(defaults, result.state);
        });
    } @catch (NSException *exception) {
        PaktaRejectError(reject, PaktaErrorWithCode(pakta::error_codes::kMarkSuccessFailed,
                                                    exception.reason ?: @"markSuccess failed"));
        return;
    }

    if (!accepted) {
        resolve(@false);
        return;
    }
    [self clearInvalidFiles];
    resolve(@true);
    #endif
}

RCT_EXPORT_METHOD(resetToPackagedBundle:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    // Reset to the bundle packaged in the binary: wipe the whole update state
    // (so the next launch resolves to the built-in bundle) and delete the
    // downloaded versions, keeping only the directory of the version this
    // process is running from (a silent reset must not break its on-demand
    __block NSString *keepVersion = nil;
    @try {
        PaktaWithStateLock(^{
            // Invalidate any in-flight cold-start round before clearing state, so
            // a round that commits under this same lock afterwards always sees the
            // new generation and drops its result.
            paktaResetGeneration.fetch_add(1);
            NSUserDefaults *defaults = PaktaDefaults();
            keepVersion = paktaLaunchVersion;

            // A default-constructed State is exactly the reset state (no current /
            // last version, first_time=false, first_time_ok=true); keep the binary
            // identity so the next launch does not re-trigger the package-updated
            // sync path.
            pakta::state::State state;
            state.package_version = PaktaToStdString([RCTPakta packageVersion]);
            state.build_time = PaktaToStdString([RCTPakta buildTime]);
            PaktaApplyStateToDefaults(defaults, state);

            PaktaClearVersionScopedState(defaults, YES);
            [defaults setObject:[RCTPakta channel] forKey:keyBinaryChannel];
            ignoreRollback = false;
        });
    } @catch (NSException *exception) {
        PaktaRejectError(reject, PaktaErrorWithCode(pakta::error_codes::kResetFailed,
                                                    exception.reason ?: @"reset failed"));
        return;
    }

    dispatch_async(_fileQueue, ^{
        // maxAgeDays=0: remove every downloaded entry except the running
        // version's directory (cleaned up by the next regular cleanup). The
        // state was just wiped, so that is the only name left to keep. The
        // promise settles here, after the cleanup, so a failed wipe reaches
        // JS as RESET_FAILED (Android parity) instead of a warning nobody
        // aggregates.
        pakta::patch::Status status = pakta::patch::CleanupOldEntries(
            PaktaToStdString([RCTPakta downloadDir]),
            std::vector<std::string>{PaktaToStdString(keepVersion)},
            0
        );
        if (!status.ok) {
            RCTLogWarn(@"Pakta reset cleanup error: %s", status.message.c_str());
            PaktaRejectError(reject, PaktaErrorWithCode(
                pakta::error_codes::kResetFailed,
                [NSString stringWithUTF8String:status.message.c_str()] ?: @"reset cleanup failed"));
            return;
        }
        resolve(@true);
    });
}



#pragma mark - private
- (NSArray<NSString *> *)supportedEvents
{
  return @[
      EVENT_PROGRESS_DOWNLOAD,
  ];
}

-(void)startObserving {
    hasListeners = YES;
}

-(void)stopObserving {
    hasListeners = NO;
}

#include "RCTPaktaInstaller.inc"
- (BOOL)switchVersion:(NSString *)hash error:(NSError **)error
{
    if (!PaktaIsSafePathComponent(hash)) {
        if (error != NULL) {
            *error = PaktaErrorWithCode(pakta::error_codes::kInvalidOptions, ERROR_OPTIONS);
        }
        return NO;
    }

    NSString *versionDir = [[RCTPakta downloadDir] stringByAppendingPathComponent:hash];
    __block uint64_t generation = 0;
    __block BOOL grandfathered = NO;
    PaktaWithStateLock(^{
        generation = paktaResetGeneration.load();
        auto state = PaktaStateFromDefaults(PaktaDefaults());
        auto target = PaktaToStdString(hash);
        grandfathered = state.current_version == target || state.last_version == target;
    });
    pakta::install_record::Activation passed;
    auto checked = pakta::install_record::CheckActivation(PaktaToStdString(versionDir),
        PaktaToStdString(hash), PaktaToStdString(BUNDLE_FILE_NAME), grandfathered, &passed);
    if (!checked.ok) {
        if (error != NULL) {
            *error = PaktaErrorWithCode(pakta::error_codes::kSwitchVersionFailed,
                PaktaFromStdString(checked.message));
        }
        return NO;
    }
    __block NSError *switchError = nil;
    PaktaWithStateLock(^{
        // Same rule as Android: only a version this SDK recorded as completely
        // installed (bundle + marker) may be activated. Markerless versions
        // activated before markers existed are grandfathered through
        // current/last state; any other markerless directory may be a
        // crash-left partial install or a directory something else put there.
        // A directory that does carry a record is verified even when it is
        // current/last.
        pakta::state::State state = PaktaStateFromDefaults(PaktaDefaults());
        std::string hashStd = PaktaToStdString(hash);
        BOOL legacyActivated = state.current_version == hashStd || state.last_version == hashStd;
        if (paktaResetGeneration.load() != generation
            || !pakta::install_record::Unchanged(PaktaToStdString(versionDir),
                PaktaToStdString(BUNDLE_FILE_NAME), legacyActivated, passed)) {
            switchError = PaktaErrorWithCode(pakta::error_codes::kSwitchVersionFailed,
                @"installation changed before activation");
            return;
        }
        PaktaSwitchVersionLocked(hash);
    });
    if (switchError != nil) {
        if (error != NULL) {
            *error = switchError;
        }
        return NO;
    }
    return YES;
}

#include "RCTPaktaInstallerFiles.inc"
#include "RCTPaktaIdentity.inc"
#ifdef RCT_NEW_ARCH_ENABLED
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
    return std::make_shared<facebook::react::NativePaktaSpecJSI>(params);
}
#endif

@end

#pragma mark - native cold-start check orchestration

// Refuses an https→http downgrade before the redirected request — and with
// it the POST body (appKey, uuid, versions) — leaves the device. The shared
// session would follow first and only the response could be rejected; ATS
// blocks plaintext by default, this covers apps that opted out with
// NSAllowsArbitraryLoads. Same rule as RCTPaktaDownloader. Returning nil
// delivers the 3xx itself as the final response, which the status check in
// PaktaHttpRequest then treats as a failed endpoint.
#include "RCTPaktaNetwork.inc"
#include "RCTPaktaOrchestrator.inc"
    const NSUInteger maxHttpAttempts = 8;
static_assert(maxHttpAttempts == pakta::updateflow::kMaxQueryRequests, "query budget parity");
#include "RCTPaktaRoundEngine.inc"
+ (BOOL)commitRoundWithGeneration:(uint64_t)generation
                         hashInfo:(NSDictionary *)hashInfoEntry
                         activate:(NSString *)hashToActivate
                     responseText:(NSString *)responseText
                          request:(NSString *)requestBody
                           config:(NSString *)configJson
                       responseAt:(long long)responseAtSeconds
                        activated:(BOOL *)activatedOut {
    // responseText is nil for the crash handler's activation-only commit
    // (activatePendingVersion): no round ran, so there is no cache to write.
    NSData *cacheData = nil;
    if (responseText != nil) {
        NSDictionary *cacheEntry = @{
            @"ts": @(responseAtSeconds),
            @"body": responseText,
            @"request": requestBody,
            @"config": configJson,
        };
        cacheData = [NSJSONSerialization dataWithJSONObject:cacheEntry options:0 error:nil];
    }
    pakta::install_record::Activation passed;
    pakta::patch::Status activationStatus = pakta::patch::Status::Ok();
    if (hashToActivate != nil) {
        activationStatus = pakta::install_record::CheckActivation(
            PaktaToStdString([[RCTPakta downloadDir] stringByAppendingPathComponent:hashToActivate]),
            PaktaToStdString(hashToActivate), PaktaToStdString(BUNDLE_FILE_NAME), false, &passed);
    }
    __block BOOL committed = NO;
    __block BOOL activated = NO;
    PaktaWithStateLock(^{
        if (paktaResetGeneration.load() != generation) {
            return;
        }
        NSString *activation = hashToActivate;
        NSDictionary *info = hashInfoEntry[@"info"];
        // The tvOS purged-version restore round (a round commit, not the
        // crash handler's activation-only one): it may take over this launch
        // only while +bundleURL still waits for it; after that the version is
        // left to JS unless a crash is being held (JS is dead then).
        if (responseText != nil && paktaPurgeRestoreActive.load()) {
            if (paktaPurgeRestoreWindowOpen) {
                if (activation != nil && info != nil) {
                    NSMutableDictionary *marked = [info mutableCopy];
                    marked[@"purgeRestore"] = @YES;
                    info = marked;
                }
            } else if (!paktaCrashRescueActive.load()) {
                activation = nil;
            }
        }
        if (activation != nil) {
            NSString *versionDir = [[RCTPakta downloadDir] stringByAppendingPathComponent:activation];
            if (!activationStatus.ok || !pakta::install_record::Unchanged(
                PaktaToStdString(versionDir), PaktaToStdString(BUNDLE_FILE_NAME), false, passed)) {
                return;
            }
        }
        NSUserDefaults *defaults = PaktaDefaults();
        if (hashInfoEntry != nil) {
            NSData *infoData = [NSJSONSerialization dataWithJSONObject:info
                                                              options:0
                                                                error:nil];
            if (infoData != nil) {
                [defaults setObject:[[NSString alloc] initWithData:infoData encoding:NSUTF8StringEncoding]
                             forKey:PaktaHashInfoKey(hashInfoEntry[@"hash"])];
            }
        }
        if (activation != nil) {
            PaktaSwitchVersionLocked(activation);
            activated = YES;
        }
        if (cacheData != nil) {
            [defaults setObject:[[NSString alloc] initWithData:cacheData encoding:NSUTF8StringEncoding]
                         forKey:keyNativeCheckCache];
        }
        committed = YES;
    });
    if (activatedOut != NULL) {
        *activatedOut = activated;
    }
    return committed;
}

@end
