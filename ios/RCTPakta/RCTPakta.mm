/**
 * [INPUT]: 依赖 React Native 桥/事件与重载 API、RCTPaktaDownloader、SSZipArchive、UIKit/NSUserDefaults、JS 冻结的启动版本身份及 patch/state/update_flow 共享 C++ 核心
 * [OUTPUT]: 对外实现 RCTPakta 模块、bundleURL、下载/切包/回滚/重置/配置 API、版本绑定成功确认、进度事件和无 JS 冷启动检查/崩溃救援
 * [POS]: iOS 更新聚合核心，统一状态锁、文件队列和原生救砖提交；Swift Expo 层与 JS 桥均复用这一事实源
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
#import "RCTPakta.h"
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
#import <objc/runtime.h>
#import <os/lock.h>

#include <atomic>
#include <sys/stat.h>

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

// event def
static NSString * const EVENT_PROGRESS_DOWNLOAD = @"RCTPaktaDownloadProgress";
static NSString * const PARAM_PROGRESS_HASH = @"hash";
static NSString * const PARAM_PROGRESS_RECEIVED = @"received";
static NSString * const PARAM_PROGRESS_TOTAL = @"total";

static NSTimeInterval PaktaMonotonicNow(void) {
    return [NSProcessInfo processInfo].systemUptime;
}

static std::string PaktaToStdString(NSString *value);

static NSString *PaktaStagingDirForVersionDir(NSString *versionDir) {
    return [versionDir stringByAppendingString:@(pakta::install_record::kStagingSuffix)];
}

// Parsed completion record (cpp/patch_core/install_record.h): nil when the
// file is absent or malformed; an empty dictionary for the legacy empty
// marker written by SDK < 10.53.
static NSDictionary *PaktaReadInstallRecord(NSString *versionDir) {
    NSString *path = [versionDir stringByAppendingPathComponent:VERSION_COMPLETE_FILE_NAME];
    NSData *data = [NSData dataWithContentsOfFile:path];
    if (data == nil) {
        return nil;
    }
    if (data.length == 0) {
        return @{};
    }
    if (data.length > 64 * 1024) {
        return nil;
    }
    id object = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    return [object isKindOfClass:[NSDictionary class]] ? (NSDictionary *)object : nil;
}

// Presence check (launch / dedup paths, no digest work): bundle present and
// the record exists and, unless legacy-empty, names this version.
static BOOL PaktaHasCompletedVersionAtPath(NSString *versionDir, NSString *hash) {
    NSString *bundlePath = [versionDir stringByAppendingPathComponent:BUNDLE_FILE_NAME];
    if (![[NSFileManager defaultManager] fileExistsAtPath:bundlePath]) {
        return NO;
    }
    NSDictionary *record = PaktaReadInstallRecord(versionDir);
    if (record == nil) {
        return NO;
    }
    if (record.count == 0) {
        return YES;
    }
    return [record[@"schema"] isKindOfClass:[NSNumber class]]
        && [record[@"schema"] intValue] == pakta::install_record::kSchema
        && [record[@"versionHash"] isKindOfClass:[NSString class]]
        && [record[@"versionHash"] isEqualToString:hash];
}

// Activation check: re-hashes the bundle when the record carries a digest.
// Returns nil when the directory may be activated, the reason otherwise.
static NSString *PaktaVerifyInstallForActivation(NSString *versionDir, NSString *hash) {
    NSDictionary *record = PaktaReadInstallRecord(versionDir);
    if (record == nil) {
        return [NSString stringWithFormat:@"Bundle version %@ has no valid completion record.", hash];
    }
    if (record.count == 0) {
        return nil;
    }
    if (![record[@"schema"] isKindOfClass:[NSNumber class]]
        || [record[@"schema"] intValue] != pakta::install_record::kSchema
        || ![record[@"versionHash"] isKindOfClass:[NSString class]]
        || ![record[@"versionHash"] isEqualToString:hash]) {
        return [NSString stringWithFormat:@"Bundle version %@ completion record mismatch.", hash];
    }
    NSString *expected = record[@"bundleSha256"];
    if (![expected isKindOfClass:[NSString class]] || expected.length == 0) {
        return nil;
    }
    std::string actual = pakta::digest::Sha256File(
        PaktaToStdString([versionDir stringByAppendingPathComponent:BUNDLE_FILE_NAME]));
    if ([[expected lowercaseString] isEqualToString:[NSString stringWithUTF8String:actual.c_str()]]) {
        return nil;
    }
    return [NSString stringWithFormat:@"Bundle version %@ bundle digest mismatch.", hash];
}

// SHA-256 of each in-flight download's archive, keyed by hash; consumed by
// the completion record write. Guarded by @synchronized on the table.
static NSMutableDictionary<NSString *, NSString *> *PaktaArtifactDigests(void) {
    static NSMutableDictionary *table;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        table = [NSMutableDictionary dictionary];
    });
    return table;
}

static NSError *PaktaErrorWithCode(const char *code, NSString *message);

// nil when the volume holding `path` can take `bytesToWrite` plus the safety
// margin (or the free space is unknown); a PATCH_FAILED error otherwise. The
// probe is the downloader's (RCTPaktaFreeSpaceShortfall), which applies the
// same rule to the announced Content-Length before the first byte lands.
static NSError *PaktaEnsureFreeSpace(NSString *path, long long bytesToWrite) {
    NSString *shortfall = RCTPaktaFreeSpaceShortfall(path, bytesToWrite);
    if (shortfall == nil) {
        return nil;
    }
    return PaktaErrorWithCode(pakta::error_codes::kPatchFailed, shortfall);
}

// SSZipArchive delegate enforcing cpp/patch_core/archive_limits.h while the
// archive is walked (entry count, per-entry size, total size, compression
// ratio) plus two entry-shape rules Android's java.util.zip gets for free:
//  - no symlinks: SSZipArchive materialises them with any target regardless
//    of preserveAttributes, so `assets -> ../../Documents` followed by
//    `assets/x` would write outside the version directory;
//  - no ".pakta-" reserved names at any depth: the completion marker is
//    written by this SDK only, after the whole install succeeded. An archive
//    shipping its own would be trusted as a finished install even if the
//    patch step that follows fails.
// A NO from zipArchiveShouldUnzipFileAtIndex: cancels the whole unzip (the
// 2.x contract the podspec pins), and the completion handler turns the
// recorded violation into a hard PATCH_FAILED; the caller then discards the
// staging directory.
@interface PaktaUnzipGuard : NSObject <SSZipArchiveDelegate>
@property (nonatomic, copy) NSString *violation;
@property (nonatomic, assign) long long totalUncompressed;
@end

@implementation PaktaUnzipGuard

- (void)zipArchiveWillUnzipArchiveAtPath:(NSString *)path zipInfo:(unz_global_info)zipInfo {
    if ((long long)zipInfo.number_entry > pakta::archive_limits::kMaxEntries) {
        self.violation = [NSString stringWithFormat:@"archive has too many entries (%lu)",
                          (unsigned long)zipInfo.number_entry];
    }
}

- (BOOL)zipArchiveShouldUnzipFileAtIndex:(NSInteger)fileIndex
                              totalFiles:(NSInteger)totalFiles
                             archivePath:(NSString *)archivePath
                                fileInfo:(unz_file_info)fileInfo {
    if (self.violation != nil) {
        return NO;
    }
    // Unix mode bits travel in the high 16 bits of the external attributes
    // (the same field SSZipArchive keys its own symlink branch on).
    if (((fileInfo.external_fa >> 16) & S_IFMT) == S_IFLNK) {
        self.violation = [NSString stringWithFormat:@"archive entry #%ld is a symlink",
                          (long)fileIndex];
        return NO;
    }
    long long size = (long long)fileInfo.uncompressed_size;
    long long compressed = (long long)fileInfo.compressed_size;
    if (size > pakta::archive_limits::kMaxEntryBytes) {
        self.violation = [NSString stringWithFormat:@"archive entry #%ld too large (%lld bytes)",
                          (long)fileIndex, size];
        return NO;
    }
    self.totalUncompressed += size;
    if (self.totalUncompressed > pakta::archive_limits::kMaxTotalUncompressedBytes) {
        self.violation = [NSString stringWithFormat:@"archive expands beyond %lld bytes",
                          pakta::archive_limits::kMaxTotalUncompressedBytes];
        return NO;
    }
    if (compressed > 0 && size > pakta::archive_limits::kRatioCheckMinBytes
        && size / compressed > pakta::archive_limits::kMaxCompressionRatio) {
        self.violation = [NSString stringWithFormat:@"archive entry #%ld compression ratio too high",
                          (long)fileIndex];
        return NO;
    }
    return YES;
}

// The entry name is only exposed once the entry is on disk (shouldUnzip
// runs before the name is read). A reserved name is flagged here; the next
// shouldUnzip refuses (cancelling the unzip) or, for the last entry, the
// completion handler picks the violation up. Either way the caller drops
// the whole staging directory, so the written file never survives.
- (void)zipArchiveDidUnzipFileAtIndex:(NSInteger)fileIndex
                           totalFiles:(NSInteger)totalFiles
                          archivePath:(NSString *)archivePath
                     unzippedFilePath:(NSString *)unzippedFilePath {
    NSString *name = unzippedFilePath.lastPathComponent;
    if (self.violation == nil && [name hasPrefix:@".pakta-"]) {
        self.violation = [NSString stringWithFormat:@"archive contains reserved entry %@", name];
    }
}

@end

static NSError *PaktaDownloadDeadlineExpiredError(void) {
    return [NSError errorWithDomain:PaktaErrorDomain
                               code:-1
                           userInfo:@{
        NSLocalizedDescriptionKey: @"download deadline expired before start",
        PaktaErrorCodeKey: PaktaCode(pakta::error_codes::kDownloadFailed),
    }];
}


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
+ (void)scheduleFromColdStart:(NSString *)launchRolledBackVersion;
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
                       responseAt:(long long)responseAtSeconds;
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

static const NSTimeInterval kPaktaRescueTriggerUptime = 60;
static const NSTimeInterval kPaktaRescueBudgetBackgroundThread = 10;
// A held main thread freezes UI teardown; stay well under the watchdog.
static const NSTimeInterval kPaktaRescueBudgetMainThread = 3.5;

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

@implementation RCTPakta {
    dispatch_queue_t _fileQueue;
    bool hasListeners;
}

RCT_EXPORT_MODULE(RCTPakta);

+ (NSURL *)bundleURL
{
    paktaIsUsingBundleUrl = true;
    __block NSURL *resolvedURL = nil;
    __block NSString *launchRolledBackVersion = nil;
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
            for (NSString *key in [defaults dictionaryRepresentation].allKeys) {
                if ([key hasPrefix:keyHashInfo]) {
                    [defaults removeObjectForKey:key];
                }
            }
            [defaults removeObjectForKey:keyNativeCheckCache];
            [defaults removeObjectForKey:keyNativeCheckIncomplete];
        } else if (sync.changed) {
            [defaults setObject:@(YES) forKey:KeyPackageUpdatedMarked];
            state = sync.state;
            PaktaApplyStateToDefaults(defaults, state);
            [defaults setObject:curChannel forKey:keyBinaryChannel];
        } else if (previousChannel == nil) {
            [defaults setObject:curChannel forKey:keyBinaryChannel];
        }
        if (channelChanged) {
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
                    RCTLogError(@"RCTPakta -- bundle version %@ not found, rolling back", loadVersion);
                    state = pakta::state::Rollback(state);
                    PaktaApplyStateToDefaults(defaults, state);
                    loadVersion = PaktaFromStdString(state.current_version);
                }
            }
        }
        // Capture before constantsToExport consumes this one-shot marker.
        // The delayed native check must never forceBoot the version that this
        // launch just rolled back.
            launchRolledBackVersion = PaktaFromStdString(state.rolled_back_version);
        });
        return resolvedURL ?: [RCTPakta binaryBundleURL];
    } @finally {
        // State corruption is exactly when the rescue path matters most. If
        // resolution throws before a snapshot exists, nil safely omits only
        // this launch's rollback guard instead of disabling the check.
        [RCTPaktaOrchestrator scheduleFromColdStart:launchRolledBackVersion];
    }
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
    [PaktaDefaults() setObject:config forKey:keyNativeConfig];
    resolve(@true);
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
    // asset loads). Only the client uuid survives — it identifies the install
    // for gray release bucketing and must not change on reset.
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

            for (NSString *key in [defaults dictionaryRepresentation].allKeys) {
                if ([key hasPrefix:keyHashInfo]) {
                    [defaults removeObjectForKey:key];
                }
            }
            [defaults removeObjectForKey:keyFirstLoadMarked];
            [defaults removeObjectForKey:KeyPackageUpdatedMarked];
            // A cached response still advertises the version this reset just
            // removed; dropping it stops the JS side from reusing that answer.
            [defaults removeObjectForKey:keyNativeCheckCache];
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

- (void)downloadUpdate:(PaktaType)type
               options:(NSDictionary *)options
              resolver:(RCTPromiseResolveBlock)resolve
              rejecter:(RCTPromiseRejectBlock)reject
{
    [self performUpdate:type options:options callback:^(NSError *error) {
        if (error != nil) {
            if (error.userInfo[PaktaErrorCodeKey] == nil) {
                // Unclassified (system/network) errors from the download
                // pipeline; keep the original message.
                error = PaktaErrorWithCode(pakta::error_codes::kDownloadFailed,
                                           error.localizedDescription);
            }
            PaktaRejectError(reject, error);
            return;
        }
        resolve(nil);
    }];
}

// Triggers a JS reload; returns nil when one was scheduled, a RESTART_FAILED
// error when this host cannot restart. React Native re-resolves the bundle
// URL itself on reload (RCTHost asks its bundleURLProvider, RCTBridge.setUp
// re-asks sourceURLForBridge:), so +bundleURL is deliberately NOT called
// here: it consumes one-shot launch state (first_time, the first-load mark,
// ignoreRollback), and consuming it for a reload that never happens would
// make the next cold start roll the freshly switched version back.
- (NSError *)reloadBridgeWithReason:(NSString *)reason
{
#if PAKTA_HAS_RELOAD_COMMAND
    dispatch_async(dispatch_get_main_queue(), ^{
        RCTTriggerReloadCommandListeners(reason);
    });
    return nil;
#else
    // No RCTReloadCommand in this React Native: only the legacy bridge can
    // reload. Under bridgeless the module's bridge is nil or an RCTBridgeProxy
    // whose -reload is a logged no-op (object_getClass avoids messaging the
    // proxy) — report that instead of resolving a restart that never happens.
    RCTBridge *bridge = self.bridge;
    if (bridge == nil || object_getClass(bridge) == NSClassFromString(@"RCTBridgeProxy")) {
        return PaktaErrorWithCode(pakta::error_codes::kRestartFailed,
                                  @"no bridge available to reload (bridgeless host without RCTReloadCommand)");
    }
    dispatch_async(dispatch_get_main_queue(), ^{
        [bridge reload];
    });
    return nil;
#endif
}

- (void)performUpdate:(PaktaType)type options:(NSDictionary *)options callback:(void (^)(NSError *error))callback
{
    NSString *updateUrl = PaktaOptionString(options, @"updateUrl");
    NSString *hash = PaktaOptionString(options, @"hash");

    if (PaktaStringIsBlank(updateUrl) || !PaktaIsSafePathComponent(hash)) {
        callback(PaktaErrorWithCode(pakta::error_codes::kInvalidOptions, ERROR_OPTIONS));
        return;
    }
    NSString *originHash = PaktaOptionString(options, @"originHash");
    if (type == PaktaTypePatchFromPpk && !PaktaIsSafePathComponent(originHash)) {
        callback(PaktaErrorWithCode(pakta::error_codes::kInvalidOptions, ERROR_OPTIONS));
        return;
    }
    
    NSString *dir = [RCTPakta downloadDir];
    BOOL success = [self ensureDirectoryExistsAtPath:dir];
    if (!success) {
        callback(PaktaErrorWithCode(pakta::error_codes::kFileOperationFailed, ERROR_FILE_OPERATION));
        return;
    }

    NSString *unzipDir = [dir stringByAppendingPathComponent:hash];
    if (PaktaHasCompletedVersionAtPath(unzipDir, hash)) {
        callback(nil);
        return;
    }

    NSTimeInterval deadlineUptime = PaktaMonotonicNow() + 600;
    NSNumber *configuredDeadline = options[@"deadlineUptime"];
    if ([configuredDeadline isKindOfClass:[NSNumber class]]) {
        deadlineUptime = configuredDeadline.doubleValue;
    }
    if (deadlineUptime <= PaktaMonotonicNow()) {
        callback(PaktaDownloadDeadlineExpiredError());
        return;
    }

    void (^progress)(long long, long long) = ^(long long receivedBytes, long long totalBytes) {
        if (self->hasListeners) {
            [self sendEventWithName:EVENT_PROGRESS_DOWNLOAD body:@{
                PARAM_PROGRESS_HASH:hash,
                PARAM_PROGRESS_RECEIVED:@(receivedBytes),
                PARAM_PROGRESS_TOTAL:@(totalBytes),
            }];
        }
    };
    void (^deferredStart)(void) = ^{
        [self performUpdate:type options:options callback:callback];
    };
    PaktaDownloadRegistration registration = PaktaRegisterDownload(
        hash, type, deadlineUptime, callback, progress, deferredStart);
    if (registration != PaktaDownloadRegistrationOwner) {
        RCTLogInfo(
            @"RCTPakta -- %@ in-flight download for %@",
            registration == PaktaDownloadRegistrationJoined ? @"join" : @"defer",
            hash);
        return;
    }

    NSString *zipFilePath = [dir stringByAppendingPathComponent:[NSString stringWithFormat:@"%@%@",hash, [self zipExtension:type]]];

    // On failure, remove the partial version directory like Android/Harmony
    // do: a half-unzipped/half-patched dir leaks disk and could later be
    // mistaken for a complete version. hash is validated non-blank above, so
    // this can never resolve to the download root itself.
    void (^completion)(NSError *) = ^(NSError *error) {
        // Settle every JS/native waiter only after cleanup or the atomic
        // completion marker write has run on the process-wide file queue.
        dispatch_async(self->_fileQueue, ^{
            NSError *finalError = error;
            NSFileManager *fileManager = [NSFileManager defaultManager];
            NSString *staging = PaktaStagingDirForVersionDir(unzipDir);
            NSString *artifactSha256 = nil;
            @synchronized (PaktaArtifactDigests()) {
                artifactSha256 = PaktaArtifactDigests()[hash];
                [PaktaArtifactDigests() removeObjectForKey:hash];
            }
            if (finalError == nil) {
                // Two-phase install (cpp/patch_core/install_record.h): the
                // completion record with the final bundle's digest goes into
                // the staging directory, which is then renamed over the
                // version directory in one atomic step.
                NSString *bundlePath = [staging stringByAppendingPathComponent:BUNDLE_FILE_NAME];
                if (![fileManager fileExistsAtPath:bundlePath]) {
                    finalError = PaktaErrorWithCode(pakta::error_codes::kPatchFailed,
                                                    @"bundle missing after install");
                } else {
                    std::string bundleSha256 = pakta::digest::Sha256File(PaktaToStdString(bundlePath));
                    NSMutableDictionary *record = [NSMutableDictionary dictionary];
                    record[@"schema"] = @(pakta::install_record::kSchema);
                    record[@"versionHash"] = hash;
                    if (!bundleSha256.empty()) {
                        record[@"bundleSha256"] = [NSString stringWithUTF8String:bundleSha256.c_str()];
                    }
                    if (artifactSha256.length > 0) {
                        record[@"artifactSha256"] = artifactSha256;
                    }
                    NSError *recordError = nil;
                    NSData *recordData = [NSJSONSerialization dataWithJSONObject:record options:0 error:&recordError];
                    NSString *marker = [staging stringByAppendingPathComponent:VERSION_COMPLETE_FILE_NAME];
                    if (recordData == nil || ![recordData writeToFile:marker
                                                               options:NSDataWritingAtomic
                                                                 error:&recordError]) {
                        finalError = recordError ?: PaktaErrorWithCode(
                            pakta::error_codes::kFileOperationFailed,
                            @"failed to write completion record");
                    } else {
                        if ([fileManager fileExistsAtPath:unzipDir]) {
                            [fileManager removeItemAtPath:unzipDir error:nil];
                        }
                        NSError *moveError = nil;
                        if (![fileManager moveItemAtPath:staging toPath:unzipDir error:&moveError]) {
                            finalError = moveError ?: PaktaErrorWithCode(
                                pakta::error_codes::kFileOperationFailed,
                                @"failed to promote staging directory");
                        }
                    }
                }
            }
            if (finalError != nil) {
                // Only the staging directory is ours to drop: the final
                // version directory is never touched by a failed install.
                [fileManager removeItemAtPath:staging error:nil];
            }
            PaktaFinishDownload(hash, finalError);
        });
    };

    RCTLogInfo(@"RCTPakta -- download file %@", updateUrl);
    NSTimeInterval timeoutSeconds = deadlineUptime - PaktaMonotonicNow();
    if (timeoutSeconds <= 0) {
        completion(PaktaDownloadDeadlineExpiredError());
        return;
    }
    [RCTPaktaDownloader download:updateUrl
                            savePath:zipFilePath
                     timeoutInterval:timeoutSeconds
                     progressHandler:^(long long receivedBytes, long long totalBytes) {
        PaktaReportDownloadProgress(hash, receivedBytes, totalBytes);
    } completionHandler:^(NSString *path, NSError *error) {
        if (error != nil) {
            completion(error);
            return;
        }
        [self unzipDownloadedPackage:zipFilePath
                                hash:hash
                                type:type
                          originHash:originHash
                            callback:completion];
    }];
}

- (void)unzipDownloadedPackage:(NSString *)zipFilePath
                          hash:(NSString *)hash
                          type:(PaktaType)type
                    originHash:(NSString *)originHash
                      callback:(void (^)(NSError *error))callback
{
    RCTLogInfo(@"RCTPakta -- unzip file %@", zipFilePath);
    // Everything lands in <hash>.staging; the completion block promotes it.
    NSString *unzipFilePath = PaktaStagingDirForVersionDir(
        [[RCTPakta downloadDir] stringByAppendingPathComponent:hash]);
    dispatch_async(_fileQueue, ^{
        // Archive digest for the completion record, taken before the unzip
        // consumes the file (same serial queue, so it runs first).
        std::string digest = pakta::digest::Sha256File(PaktaToStdString(zipFilePath));
        @synchronized (PaktaArtifactDigests()) {
            PaktaArtifactDigests()[hash] = [NSString stringWithUTF8String:digest.c_str()];
        }
    });
    [self unzipFileAtPath:zipFilePath
            toDestination:unzipFilePath
        completionHandler:^(NSError *error) {
        dispatch_async(self->_fileQueue, ^{
            if (error != nil) {
                callback(error);
                return;
            }
            @try {
                [self finishDownloadedPackage:hash type:type originHash:originHash callback:callback];
            } @catch (NSException *exception) {
                // An uncaught exception in a GCD block is fatal (and would
                // trip the crash rescue); a bad package is a PATCH_FAILED.
                callback(PaktaErrorWithCode(pakta::error_codes::kPatchFailed,
                                            exception.reason ?: @"patch failed"));
            }
        });
    }];
}

- (void)finishDownloadedPackage:(NSString *)hash
                           type:(PaktaType)type
                     originHash:(NSString *)originHash
                       callback:(void (^)(NSError *error))callback
{
    switch (type) {
        case PaktaTypePatchFromPackage:
            [self applyPatchForHash:hash
                               type:type
                         fromBundle:[[RCTPakta binaryBundleURL] path]
                             source:[[NSBundle mainBundle] resourcePath]
                           callback:callback];
            return;
        case PaktaTypePatchFromPpk: {
            NSString *lastVersionDir = [[RCTPakta downloadDir] stringByAppendingPathComponent:originHash];
            [self applyPatchForHash:hash
                               type:type
                         fromBundle:[lastVersionDir stringByAppendingPathComponent:BUNDLE_FILE_NAME]
                             source:lastVersionDir
                           callback:callback];
            return;
        }
        case PaktaTypeFullDownload:
            callback(nil);
            return;
    }
}

- (void)applyPatchForHash:(NSString *)hash
                     type:(PaktaType)type
               fromBundle:(NSString *)bundleOrigin
                   source:(NSString *)sourceOrigin
                 callback:(void (^)(NSError *error))callback
{
    // Patch work happens in the staging directory (two-phase install).
    NSString *unzipDir = PaktaStagingDirForVersionDir(
        [[RCTPakta downloadDir] stringByAppendingPathComponent:hash]);
    NSString *sourcePatch = [unzipDir stringByAppendingPathComponent:SOURCE_PATCH_NAME];
    NSString *bundlePatch = [unzipDir stringByAppendingPathComponent:BUNDLE_PATCH_NAME];
    
    NSString *destination = [unzipDir stringByAppendingPathComponent:BUNDLE_FILE_NAME];
    long long manifestBytes = RCTPaktaFileSize(sourcePatch);
    if (manifestBytes > pakta::archive_limits::kMaxManifestBytes) {
        callback(PaktaErrorWithCode(pakta::error_codes::kPatchFailed,
            [NSString stringWithFormat:@"patch manifest too large: %lld bytes", manifestBytes]));
        return;
    }
    NSData *data = [NSData dataWithContentsOfFile:sourcePatch];
    if (data == nil) {
        callback(PaktaErrorWithCode(pakta::error_codes::kPatchFailed, @"missing patch manifest"));
        return;
    }

    NSError *error = nil;
    id jsonObject = [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingAllowFragments error:&error];
    if (error != nil) {
        // Classify as a patch failure like the sibling manifest branches;
        // unclassified errors would otherwise be tagged DOWNLOAD_FAILED by the
        // downloadUpdate fallback even though the download itself succeeded.
        callback(PaktaErrorWithCode(pakta::error_codes::kPatchFailed, error.localizedDescription));
        return;
    }
    if (![jsonObject isKindOfClass:[NSDictionary class]]) {
        callback(PaktaErrorWithCode(pakta::error_codes::kPatchFailed, @"invalid patch manifest"));
        return;
    }
    NSDictionary *json = (NSDictionary *)jsonObject;
    pakta::patch::PatchManifest manifest;
    NSString *manifestReason = nil;
    if (!PaktaPatchManifestFromJson(json, &manifest, &manifestReason)) {
        callback(PaktaErrorWithCode(pakta::error_codes::kPatchFailed, manifestReason));
        return;
    }

    std::vector<std::string> entryNames;
    if ([[NSFileManager defaultManager] fileExistsAtPath:sourcePatch isDirectory:NULL]) {
        entryNames.push_back(PaktaToStdString(SOURCE_PATCH_NAME));
    }
    if ([[NSFileManager defaultManager] fileExistsAtPath:bundlePatch isDirectory:NULL]) {
        entryNames.push_back(PaktaToStdString(BUNDLE_PATCH_NAME));
    }

    pakta::archive_patch::ArchivePatchPlan plan;
    pakta::patch::Status planStatus = pakta::archive_patch::BuildArchivePatchPlan(
        type == PaktaTypePatchFromPackage
            ? pakta::archive_patch::ArchivePatchType::kPatchFromPackage
            : pakta::archive_patch::ArchivePatchType::kPatchFromPpk,
        manifest,
        entryNames,
        &plan
    );
    if (!planStatus.ok) {
        callback(PaktaNSErrorFromStatus(planStatus));
        return;
    }

    pakta::patch::FileSourcePatchOptions options;
    pakta::patch::Status optionStatus = pakta::archive_patch::BuildFileSourcePatchOptions(
        plan,
        PaktaToStdString(sourceOrigin),
        PaktaToStdString(unzipDir),
        PaktaToStdString(bundleOrigin),
        PaktaToStdString(bundlePatch),
        PaktaToStdString(destination),
        &options
    );
    if (!optionStatus.ok) {
        callback(PaktaNSErrorFromStatus(optionStatus));
        return;
    }

    // __diff.json 的 hbcTransform 元数据(HBC 变换域 patch,hdiffv2 轨道):
    // 存在时透传给 patch 内核执行 T(origin) → hpatch → T⁻¹;缺失走现状路径。
    NSDictionary *hbcTransform = json[@"hbcTransform"];
    if ([hbcTransform isKindOfClass:[NSDictionary class]]) {
        NSDictionary *meta = hbcTransform[BUNDLE_PATCH_NAME];
        if ([meta isKindOfClass:[NSDictionary class]]) {
            NSError *metaError = nil;
            NSData *metaData = [NSJSONSerialization dataWithJSONObject:meta options:0 error:&metaError];
            if (metaData != nil && metaError == nil) {
                NSString *metaString = [[NSString alloc] initWithData:metaData encoding:NSUTF8StringEncoding];
                options.bundle_hbc_transform_meta = PaktaToStdString(metaString);
            }
        }
    }

    pakta::patch::Status status = pakta::patch::ApplyPatchFromFileSource(options);
    if (!status.ok) {
        callback(PaktaNSErrorFromStatus(status));
        return;
    }

    callback(nil);
}

- (BOOL)switchVersion:(NSString *)hash error:(NSError **)error
{
    if (!PaktaIsSafePathComponent(hash)) {
        if (error != NULL) {
            *error = PaktaErrorWithCode(pakta::error_codes::kInvalidOptions, ERROR_OPTIONS);
        }
        return NO;
    }

    __block NSError *switchError = nil;
    PaktaWithStateLock(^{
        // Same rule as Android: only a version this SDK recorded as completely
        // installed (bundle + marker) may be activated. Versions activated
        // before markers existed are grandfathered through current/last
        // state; any other markerless directory may be a crash-left partial
        // install or a directory something else put there.
        NSString *versionDir = [[RCTPakta downloadDir] stringByAppendingPathComponent:hash];
        pakta::state::State state = PaktaStateFromDefaults(PaktaDefaults());
        std::string hashStd = PaktaToStdString(hash);
        BOOL legacyActivated = state.current_version == hashStd || state.last_version == hashStd;
        if (!PaktaHasCompletedVersionAtPath(versionDir, hash) && !legacyActivated) {
            BOOL hasBundle = [[NSFileManager defaultManager] fileExistsAtPath:
                [versionDir stringByAppendingPathComponent:BUNDLE_FILE_NAME]];
            switchError = PaktaErrorWithCode(
                pakta::error_codes::kSwitchVersionFailed,
                [NSString stringWithFormat:@"Bundle version %@ %@", hash,
                    hasBundle ? @"is incomplete." : @"not found."]);
            return;
        }
        if (!legacyActivated) {
            // The record's bundle digest must match the bytes on disk before
            // the next launch is pointed at them.
            NSString *reason = PaktaVerifyInstallForActivation(versionDir, hash);
            if (reason != nil) {
                switchError = PaktaErrorWithCode(pakta::error_codes::kSwitchVersionFailed, reason);
                return;
            }
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

- (BOOL)ensureDirectoryExistsAtPath:(NSString *)path
{
    // No _fileQueue hop here: that queue also runs multi-second unzip/patch
    // work, and a dispatch_sync onto it would block the whole module method
    // queue for the duration. createDirectoryAtPath is idempotent and
    // thread-safe, so checking inline is fine.
    NSFileManager *fileManager = [NSFileManager defaultManager];
    BOOL isDirectory = NO;
    if ([fileManager fileExistsAtPath:path isDirectory:&isDirectory]) {
        if (isDirectory) {
            // Directories created by older versions never got the flag.
            [RCTPakta excludeFromBackup:path];
        }
        return isDirectory;
    }

    NSError *error = nil;
    BOOL success = [fileManager createDirectoryAtPath:path
                          withIntermediateDirectories:YES
                                           attributes:nil
                                                error:&error];
    if (!success && error != nil) {
        RCTLogWarn(@"Pakta create directory error: %@", error.localizedDescription);
    }
    if (success) {
        [RCTPakta excludeFromBackup:path];
    }

    return success;
}

// Everything under rctpakta is re-downloadable, and Application Support is
// backed up to iCloud by default — Apple requires such content to be
// excluded from backups.
+ (void)excludeFromBackup:(NSString *)path
{
    NSURL *url = [NSURL fileURLWithPath:path isDirectory:YES];
    NSError *error = nil;
    if (![url setResourceValue:@YES
                        forKey:NSURLIsExcludedFromBackupKey
                         error:&error]) {
        RCTLogWarn(@"Pakta exclude from backup error: %@", error.localizedDescription);
    }
}

- (void)unzipFileAtPath:(NSString *)path
          toDestination:(NSString *)destination
      completionHandler:(void (^)(NSError *error))completionHandler
{
    dispatch_async(_fileQueue, ^{
        NSFileManager *fileManager = [NSFileManager defaultManager];
        if ([fileManager fileExistsAtPath:destination]) {
            [fileManager removeItemAtPath:destination error:nil];
        }

        // Resource caps before the first byte is extracted
        // (cpp/patch_core/archive_limits.h). SSZipArchive only exposes the
        // entry count up front (zipArchiveWillUnzipArchiveAtPath:zipInfo:),
        // not the uncompressed total, so the disk check uses a 2x-archive
        // heuristic; the delegate below enforces the exact caps entry by
        // entry.
        long long archiveBytes = RCTPaktaFileSize(path);
        NSError *preflight = nil;
        if (archiveBytes > pakta::archive_limits::kMaxArchiveBytes) {
            preflight = PaktaErrorWithCode(pakta::error_codes::kPatchFailed,
                [NSString stringWithFormat:@"archive too large: %lld bytes", archiveBytes]);
        } else {
            preflight = PaktaEnsureFreeSpace(destination, MAX(0LL, archiveBytes) * 2);
        }
        if (preflight != nil) {
            [fileManager removeItemAtPath:path error:nil];
            [fileManager removeItemAtPath:RCTPaktaResumeSidecarPath(path) error:nil];
            if (completionHandler != nil) {
                completionHandler(preflight);
            }
            return;
        }

        PaktaUnzipGuard *guard = [PaktaUnzipGuard new];
        // preserveAttributes:NO — the archive's mode/mtime bits have no use
        // here and are one less thing a hostile package controls.
        [SSZipArchive unzipFileAtPath:path
                        toDestination:destination
                   preserveAttributes:NO
                            overwrite:YES
                       nestedZipLevel:0
                             password:nil
                                error:nil
                             delegate:guard
                      progressHandler:nil
                    completionHandler:^(NSString *archivePath, BOOL succeeded, NSError *error) {
            [fileManager removeItemAtPath:archivePath error:nil];
            // The resume sidecar dies with its archive (§11.4): whether the
            // unzip consumed it or classified it as poisoned, nothing must
            // survive to vouch for bytes that are gone.
            [fileManager removeItemAtPath:RCTPaktaResumeSidecarPath(archivePath) error:nil];
            if (completionHandler == nil) {
                return;
            }

            NSError *unzipError = error;
            if (guard.violation != nil) {
                unzipError = PaktaErrorWithCode(pakta::error_codes::kPatchFailed, guard.violation);
            } else if (!succeeded && unzipError == nil) {
                unzipError = PaktaErrorWithCode(pakta::error_codes::kPatchFailed, @"unzip failed");
            } else if (unzipError != nil && unzipError.userInfo[PaktaErrorCodeKey] == nil) {
                // SSZipArchive's own NSError (corrupt zip, bad magic, ...) has
                // no stable code; without one, downloadUpdate's fallback would
                // classify it as DOWNLOAD_FAILED even though the download
                // succeeded — keep the classification deterministic.
                unzipError = PaktaErrorWithCode(pakta::error_codes::kPatchFailed,
                                                unzipError.localizedDescription ?: @"unzip failed");
            }
            completionHandler(unzipError);
        }];
    });
}

- (void)clearInvalidFiles
{
    dispatch_async(_fileQueue, ^{
        // Snapshot the state under the lock, but run the (slow) filesystem
        // cleanup outside of it so state operations are not blocked.
        __block pakta::state::State state;
        __block NSString *launchVersion = nil;
        PaktaWithStateLock(^{
            state = PaktaStateFromDefaults(PaktaDefaults());
            launchVersion = paktaLaunchVersion;
        });
        NSString *downloadDir = [RCTPakta downloadDir];
        // Keep the persisted current/last versions AND the version this
        // process booted from: two switches without a restart would otherwise
        // evict the running bundle while its on-demand assets are still
        // being served.
        pakta::patch::Status status = pakta::patch::CleanupOldEntries(
            PaktaToStdString(downloadDir),
            std::vector<std::string>{
                state.current_version,
                state.last_version,
                PaktaToStdString(launchVersion),
            },
            3
        );
        if (!status.ok) {
            RCTLogWarn(@"Pakta cleanup error: %s", status.message.c_str());
        }
    });
}

- (NSString *)zipExtension:(PaktaType)type
{
    switch (type) {
        case PaktaTypePatchFromPackage:
            return @".ipa.patch";
        case PaktaTypePatchFromPpk:
            return @".ppk.patch";
        case PaktaTypeFullDownload:
            break;
    }
    return @".ppk";
}

+ (NSString *)downloadDir
{
    NSString *directory = [NSSearchPathForDirectoriesInDomains(NSApplicationSupportDirectory, NSUserDomainMask, YES) firstObject];
    return [directory stringByAppendingPathComponent:@"rctpakta"];
}

+ (NSURL *)binaryBundleURL
{
    return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
}

+ (NSString *)packageVersion
{
    static NSString *version = nil;

    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        NSDictionary *infoDictionary = [[NSBundle mainBundle] infoDictionary];
        version = [infoDictionary objectForKey:@"CFBundleShortVersionString"];
    });
    return version;
}

+ (NSString *)buildTime
{
#if DEBUG
    return @"0";
#else
    static NSString *buildTime;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        // The podspec's s.resource lands in the app bundle for a static
        // library but inside this pod's own framework bundle under
        // use_frameworks!; look in both.
        NSString *stampPath =
            [[NSBundle mainBundle] pathForResource:@"pakta_build_time" ofType:@"txt"]
            ?: [[NSBundle bundleForClass:[RCTPakta class]] pathForResource:@"pakta_build_time"
                                                                   ofType:@"txt"];
        NSString *stamp = stampPath == nil ? nil
            : [[NSString stringWithContentsOfFile:stampPath encoding:NSUTF8StringEncoding error:nil]
                  stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
        if (stamp.length == 0) {
            // Never empty: with "" SyncBinaryVersion would miss a rebuilt
            // binary that kept its CFBundleShortVersionString, and a stale
            // hot update would outlive an App Store update. A correctly
            // packaged binary always carries the UUID resource; this
            // last-resort value stays opaque rather than exposing a timestamp.
            RCTLogWarn(@"RCTPakta -- pakta_build_time.txt %@; using a generated UUID as buildTime",
                       stampPath == nil ? @"not found in the main or framework bundle" : @"is empty");
            stamp = [[[NSUUID UUID] UUIDString] lowercaseString];
        }
        buildTime = stamp;
    });
    return buildTime;
#endif
}

+ (NSString *)channel
{
    static NSString *channel;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        id value = [[[NSBundle mainBundle] infoDictionary] objectForKey:@"channel"];
        channel = [value isKindOfClass:[NSString class]] && [value length] > 0
            ? [value stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]]
            : @"default";
        if (channel.length == 0) channel = @"default";
    });
    return channel;
}

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
@interface PaktaCheckRequestRedirectGuard : NSObject <NSURLSessionTaskDelegate>
@end

@implementation PaktaCheckRequestRedirectGuard

- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task
willPerformHTTPRedirection:(NSHTTPURLResponse *)response
        newRequest:(NSURLRequest *)request
 completionHandler:(void (^)(NSURLRequest *))completionHandler
{
    NSString *originalScheme = [task.originalRequest.URL.scheme lowercaseString];
    NSString *nextScheme = [request.URL.scheme lowercaseString];
    if ([originalScheme isEqualToString:@"https"] && [nextScheme isEqualToString:@"http"]) {
        completionHandler(nil);
        return;
    }
    completionHandler(request);
}

@end

// Blocking JSON HTTP round-trip on the orchestrator's utility thread. Returns
// the response body on 2xx, nil on any failure. The semaphore timeout is a
// backstop over the request's own timeoutInterval.
static NSString *PaktaHttpRequest(NSString *urlString, NSString *method,
                                  NSString *body, NSTimeInterval timeout) {
    NSURL *url = [NSURL URLWithString:urlString];
    if (url == nil) {
        return nil;
    }
    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
    request.HTTPMethod = method;
    request.timeoutInterval = timeout;
    [request setValue:@"application/json" forHTTPHeaderField:@"Accept"];
    if (body != nil) {
        [request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
        request.HTTPBody = [body dataUsingEncoding:NSUTF8StringEncoding];
    }
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    __block NSString *result = nil;
    // A delegate session (not the shared one) so the redirect guard sees the
    // 3xx before it is followed; the completion handler still receives the
    // final response.
    NSURLSession *session = [NSURLSession
        sessionWithConfiguration:[NSURLSessionConfiguration defaultSessionConfiguration]
                        delegate:[PaktaCheckRequestRedirectGuard new]
                   delegateQueue:nil];
    NSURLSessionDataTask *task = [session dataTaskWithRequest:request
        completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
            NSHTTPURLResponse *httpResponse =
                [response isKindOfClass:[NSHTTPURLResponse class]]
                    ? (NSHTTPURLResponse *)response
                    : nil;
            NSInteger status = httpResponse.statusCode;
            if (error == nil && httpResponse != nil && status >= 200 && status < 300
                && data != nil) {
                result = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
            }
            dispatch_semaphore_signal(sem);
        }];
    [task resume];
    // The session retains its delegate until invalidated: let this one task
    // settle, then release everything.
    [session finishTasksAndInvalidate];
    if (dispatch_semaphore_wait(
            sem, dispatch_time(DISPATCH_TIME_NOW,
                               (int64_t)((timeout + 5) * NSEC_PER_SEC))) != 0) {
        [task cancel];
        return nil;
    }
    return result;
}

static NSString *PaktaNormalizeEndpointBase(NSString *base) {
    while ([base hasSuffix:@"/"]) {
        base = [base substringToIndex:base.length - 1];
    }
    return base;
}

static BOOL PaktaIsValidCheckResponse(NSString *responseText) {
    if (responseText == nil) {
        return NO;
    }
    // Shared schema rule (update_flow_core::IsValidCheckResponse): a 200 with
    // `{"error": ...}` is a failed endpoint, not a verdict.
    return updateflow::IsValidCheckResponse(PaktaToStdString(responseText)) ? YES : NO;
}

@implementation RCTPaktaOrchestrator

+ (void)scheduleFromColdStart:(NSString *)launchRolledBackVersion {
#if !DEBUG
    // Once per process; a few seconds of delay keeps the check away from the
    // cold-start critical path (§7 R5) — its result targets the NEXT launch.
    // Unless the previous process died mid-round (residual incomplete
    // marker), in which case every launch second counts (§11.4).
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        paktaRoundDone = dispatch_semaphore_create(0);
        paktaProcessAnchorUptime = PaktaMonotonicNow();
        paktaLaunchRolledBackForRescue = [launchRolledBackVersion copy];
        NSUserDefaults *defaults = PaktaDefaults();
        // The crash-hold rescue shares the orchestrator's rollout gate: no
        // persisted config, no handler (§11.3).
        if ([defaults stringForKey:keyNativeConfig].length > 0) {
            PaktaInstallCrashRescueHandler();
        }
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
    return persisted != nil && [persisted isEqualToString:jsConfig];
}

// Runs the process's single round on the calling thread if nobody has
// started it yet. deadlineUptime > 0 (crash rescue) caps every HTTP call and
// download phase to the remaining budget.
+ (void)startRoundWithDeadline:(NSTimeInterval)deadlineUptime {
    bool expected = false;
    if (!paktaRoundStarted.compare_exchange_strong(expected, true)) {
        return;
    }
    @try {
        [self runOnce:paktaLaunchRolledBackForRescue deadline:deadlineUptime];
    } @catch (NSException *exception) {
        // The rescue path must never take the app down with it.
        RCTLogWarn(@"RCTPakta -- native check crashed: %@", exception.reason);
    } @finally {
        paktaRoundCompleted.store(true);
        dispatch_semaphore_signal(paktaRoundDone);
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
    if (!paktaRoundCompleted.load()) {
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
                                          responseAt:0];
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

+ (void)runOnce:(NSString *)launchRolledBackVersion deadline:(NSTimeInterval)deadlineUptime {
    // Sampled before any IO: resetToPackagedBundle bumps it, and a reset that
    // lands while this round is running must win over the round's decision.
    const uint64_t resetGeneration = paktaResetGeneration.load();
    NSUserDefaults *defaults = PaktaDefaults();
    NSString *configJson = [defaults stringForKey:keyNativeConfig];
    if (configJson.length == 0) {
        // No persisted config (old integration / first ever launch): the
        // native check silently does not run — this is the rollout gate.
        return;
    }
    bool ok = false;
    flowjson::Value config = flowjson::Parse(PaktaToStdString(configJson), &ok);
    if (!ok || !config.IsObject() || config.Get("disabled").Truthy()) {
        return;
    }
    NSString *appKey = PaktaFromStdString(config.Get("appKey").AsString());
    if (appKey.length == 0) {
        return;
    }
    // From here on the round does real work: leave the breadcrumb that the
    // next launch reads to skip its 5s delay if we die mid-round (§11.4).
    [defaults setObject:@YES forKey:keyNativeCheckIncomplete];
    @try {
        [self runConfiguredRound:config
                      configJson:configJson
                          appKey:appKey
        launchRolledBackVersion:launchRolledBackVersion
                 resetGeneration:resetGeneration
                        deadline:deadlineUptime];
    } @finally {
        [defaults removeObjectForKey:keyNativeCheckIncomplete];
    }
}

+ (void)runConfiguredRound:(const flowjson::Value &)config
                configJson:(NSString *)configJson
                    appKey:(NSString *)appKey
   launchRolledBackVersion:(NSString *)launchRolledBackVersion
           resetGeneration:(uint64_t)resetGeneration
                  deadline:(NSTimeInterval)deadlineUptime {
    NSUserDefaults *defaults = PaktaDefaults();
    NSString *packageVersion =
        PaktaFromStdString(config.Get("packageVersion").AsString());
    if (packageVersion.length == 0) {
        packageVersion = [RCTPakta packageVersion];
    }

    __block NSString *currentVersion = nil;
    PaktaWithStateLock(^{
        pakta::state::State state = PaktaStateFromDefaults(PaktaDefaults());
        currentVersion = PaktaFromStdString(state.current_version);
    });
    NSString *rolledBackVersion = launchRolledBackVersion;
    NSString *uuid = [defaults stringForKey:keyUuid] ?: @"";

    flowjson::Value identity = flowjson::Value::Object();
    identity.Set("packageVersion",
                 flowjson::Value::String(PaktaToStdString(packageVersion)));
    if (currentVersion != nil) {
        identity.Set("currentVersion",
                     flowjson::Value::String(PaktaToStdString(currentVersion)));
    }
    identity.Set("uuid", flowjson::Value::String(PaktaToStdString(uuid)));
    if (rolledBackVersion != nil) {
        identity.Set("rolledBackVersion",
                     flowjson::Value::String(PaktaToStdString(rolledBackVersion)));
    }

    flowjson::Value cInfo = flowjson::Value::Object();
    cInfo.Set("rnu", config.Get("rnu"));
    cInfo.Set("rn", config.Get("rn"));
    cInfo.Set("os", flowjson::Value::String(PaktaToStdString([NSString
        stringWithFormat:@"ios %@", [[UIDevice currentDevice] systemVersion]])));
    cInfo.Set("uuid", flowjson::Value::String(PaktaToStdString(uuid)));

    flowjson::Value input = flowjson::Value::Object();
    input.Set("packageVersion", identity.Get("packageVersion"));
    // 渠道由宿主 Info.plist 固化，不能被 JS/native config 覆盖。
    input.Set("channel", flowjson::Value::String(PaktaToStdString([RCTPakta channel])));
    if (currentVersion != nil) {
        input.Set("currentVersion", identity.Get("currentVersion"));
    }
    input.Set("buildTime",
              flowjson::Value::String(PaktaToStdString([RCTPakta buildTime])));
    input.Set("cInfo", cInfo);
    input.Set("supportedDiffVersion",
              flowjson::Value::Number(pakta::hbc::kSupportedDiffVersion));
    // Cache-only while a crash is being held (§11.3 budget); computed (and
    // shared with JS getBundleHash) on the ordinary delayed round.
    input.Set("bundleHash",
              flowjson::Value::String(PaktaToStdString(
                  PaktaBundleHashSync(!paktaCrashRescueActive.load()))));

    std::string bodyJson =
        flowjson::Stringify(updateflow::BuildCheckRequestBody(input));
    NSString *body = [NSString stringWithUTF8String:bodyJson.c_str()];
    if (body == nil) {
        RCTLogWarn(@"RCTPakta -- native check: request body is not valid UTF-8");
        return;
    }

    NSString *responseText = [self runCheckRequest:config
                                            appKey:appKey
                                              body:body
                                          deadline:deadlineUptime];
    if (responseText == nil) {
        RCTLogInfo(@"RCTPakta -- native check: no endpoint reachable, giving up until next launch");
        return;
    }
    long long responseAtSeconds = (long long)[[NSDate date] timeIntervalSince1970];

    flowjson::Value decision = updateflow::HandleCheckResponse(
        PaktaToStdString(responseText), identity, false,
        config.Get("afterDownload").AsString());
    if (decision.Get("action").AsString() != "download") {
        [self commitRoundWithGeneration:resetGeneration
                               hashInfo:nil
                               activate:nil
                           responseText:responseText
                                request:body
                                 config:configJson
                             responseAt:responseAtSeconds];
        RCTLogInfo(@"RCTPakta -- native check: nothing to do (%s)",
                   decision.Get("reason").AsString().c_str());
        return;
    }
    NSString *hash = PaktaFromStdString(decision.Get("hash").AsString());
    if (!PaktaIsSafePathComponent(hash)) {
        return;
    }

    NSString *versionDir = [[RCTPakta downloadDir] stringByAppendingPathComponent:hash];
    BOOL downloaded = PaktaHasCompletedVersionAtPath(versionDir, hash);
    if (!downloaded) {
        downloaded = [self performAttempts:decision.Get("attempts")
                                      hash:hash
                                originHash:currentVersion
                                  deadline:deadlineUptime];
    }
    if (!downloaded) {
        [self commitRoundWithGeneration:resetGeneration
                               hashInfo:nil
                               activate:nil
                           responseText:responseText
                                request:body
                                 config:configJson
                             responseAt:responseAtSeconds];
        return;
    }

    // Persist name/description/metaInfo alongside the version, mirroring the
    // JS side's setLocalHashInfo after a successful download.
    const flowjson::Value &info = decision.Get("info");
    NSMutableDictionary *versionInfo = [NSMutableDictionary dictionary];
    for (const char *key : {"name", "description", "metaInfo"}) {
        if (info.Get(key).IsString()) {
            versionInfo[@(key)] = PaktaFromStdString(info.Get(key).AsString()) ?: @"";
        }
    }
    // A forceBoot activation is the brick-rescue path: mark it in the
    // persisted info so JS can report force_boot_rescue when this version
    // survives to markSuccess. Only the server-sent directive counts — a
    // silent-strategy activation is ordinary delivery.
    if (info.Get("config").Get("forceBoot").Truthy()) {
        versionInfo[@"forceBootRescue"] = @YES;
    }
    if (paktaCrashRescueActive.load()) {
        versionInfo[@"crashRescue"] = @YES;
    }
    // Silent strategies or a server-marked forceBoot version (per-version
    // remote override — the brick rescue) activate for the next launch;
    // otherwise activation stays with the JS side (§6/§10.1). Unless a crash
    // is being held: JS is dead, deferring to it would leave the fix on disk
    // forever (§11.3).
    BOOL activate = decision.Get("activate").Truthy() || paktaCrashRescueActive.load();
    BOOL committed = [self commitRoundWithGeneration:resetGeneration
                                            hashInfo:@{@"hash": hash, @"info": versionInfo}
                                            activate:activate ? hash : nil
                                        responseText:responseText
                                             request:body
                                              config:configJson
                                          responseAt:responseAtSeconds];
    if (!committed) {
        RCTLogInfo(@"RCTPakta -- native check: reset during round, dropping result");
    } else if (activate) {
        @synchronized (self) {
            paktaUnactivatedHash = nil;
        }
        RCTLogInfo(@"RCTPakta -- native check: downloaded %@ and set for next launch", hash);
    } else {
        // Remembered so a crash later in this process can still activate it
        // (activatePendingVersion) — JS never will.
        @synchronized (self) {
            paktaUnactivatedHash = [hash copy];
            paktaUnactivatedGeneration = resetGeneration;
        }
        RCTLogInfo(@"RCTPakta -- native check: downloaded %@, activation left to JS", hash);
    }
}

// Everything a round persists — version info, the activation, the response
// cache — is written inside ONE state-lock acquisition that first re-checks the
// reset generation. resetToPackagedBundle bumps that generation under the same
// lock, so there is no compare-and-act window: either the whole round commits,
// or the reset wins and none of it does.
+ (BOOL)commitRoundWithGeneration:(uint64_t)generation
                         hashInfo:(NSDictionary *)hashInfoEntry
                         activate:(NSString *)hashToActivate
                     responseText:(NSString *)responseText
                          request:(NSString *)requestBody
                           config:(NSString *)configJson
                       responseAt:(long long)responseAtSeconds {
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
    __block BOOL committed = NO;
    PaktaWithStateLock(^{
        if (paktaResetGeneration.load() != generation) {
            return;
        }
        NSUserDefaults *defaults = PaktaDefaults();
        if (hashInfoEntry != nil) {
            NSData *infoData = [NSJSONSerialization dataWithJSONObject:hashInfoEntry[@"info"]
                                                              options:0
                                                                error:nil];
            if (infoData != nil) {
                [defaults setObject:[[NSString alloc] initWithData:infoData encoding:NSUTF8StringEncoding]
                             forKey:PaktaHashInfoKey(hashInfoEntry[@"hash"])];
            }
        }
        if (hashToActivate != nil) {
            PaktaSwitchVersionLocked(hashToActivate);
        }
        if (cacheData != nil) {
            [defaults setObject:[[NSString alloc] initWithData:cacheData encoding:NSUTF8StringEncoding]
                         forKey:keyNativeCheckCache];
        }
        committed = YES;
    });
    return committed;
}

// Sequential fallback over the ordered candidates (§5.1): one request at a
// time with its own timeout; after the configured round fails, queryUrls
// discovery merges remote candidates (excluding the already-tried) for one
// more round. No hedged race on purpose — this path is latency-insensitive.
// Per-request timeout, capped to the crash-rescue budget when one is active.
// <= 0 means the budget is gone and the round must stop issuing requests.
static NSTimeInterval PaktaCheckRequestTimeout(NSTimeInterval deadlineUptime) {
    if (deadlineUptime <= 0) {
        return 10;
    }
    return MIN(10, deadlineUptime - PaktaMonotonicNow());
}

+ (NSString *)runCheckRequest:(const flowjson::Value &)config
                       appKey:(NSString *)appKey
                         body:(NSString *)body
                     deadline:(NSTimeInterval)deadlineUptime {
    double sample = arc4random() / 4294967296.0;
    flowjson::Value ordered =
        updateflow::OrderEndpointCandidates(config.Get("endpoints"), sample);
    NSMutableSet<NSString *> *tried = [NSMutableSet set];
    const NSUInteger maxHttpAttempts = 8;
    NSUInteger httpAttempts = 0;
    for (const auto &endpoint : ordered.elements()) {
        NSString *base = PaktaNormalizeEndpointBase(
            PaktaFromStdString(endpoint.AsString()));
        if (base.length == 0 || [tried containsObject:base]) {
            continue;
        }
        if (httpAttempts++ >= maxHttpAttempts) {
            return nil;
        }
        [tried addObject:base];
        NSTimeInterval timeout = PaktaCheckRequestTimeout(deadlineUptime);
        if (timeout <= 0) {
            return nil;
        }
        NSString *response = PaktaHttpRequest(
            [NSString stringWithFormat:@"%@/checkUpdate/%@", base, appKey],
            @"POST", body, timeout);
        if (PaktaIsValidCheckResponse(response)) {
            return response;
        }
    }
    for (const auto &queryUrl : config.Get("queryUrls").elements()) {
        NSString *listUrl = PaktaFromStdString(queryUrl.AsString());
        if (listUrl == nil) {
            continue;
        }
        if (httpAttempts++ >= maxHttpAttempts) {
            return nil;
        }
        NSTimeInterval listTimeout = PaktaCheckRequestTimeout(deadlineUptime);
        if (listTimeout <= 0) {
            return nil;
        }
        NSString *listText = PaktaHttpRequest(listUrl, @"GET", nil, listTimeout);
        if (listText == nil) {
            continue;
        }
        bool ok = false;
        flowjson::Value remote = flowjson::Parse(PaktaToStdString(listText), &ok);
        if (!ok || !remote.IsArray()) {
            continue;
        }
        for (const auto &endpoint : remote.elements()) {
            NSString *base = PaktaNormalizeEndpointBase(
                PaktaFromStdString(endpoint.AsString()));
            if (base.length == 0 || [tried containsObject:base]) {
                continue;
            }
            if (httpAttempts++ >= maxHttpAttempts) {
                return nil;
            }
            [tried addObject:base];
            NSTimeInterval timeout = PaktaCheckRequestTimeout(deadlineUptime);
            if (timeout <= 0) {
                return nil;
            }
            NSString *response = PaktaHttpRequest(
                [NSString stringWithFormat:@"%@/checkUpdate/%@", base, appKey],
                @"POST", body, timeout);
            if (PaktaIsValidCheckResponse(response)) {
                return response;
            }
        }
        break;  // one successfully fetched remote list is enough
    }
    return nil;
}

+ (BOOL)performAttempts:(const flowjson::Value &)attempts
                   hash:(NSString *)hash
             originHash:(NSString *)originHash
               deadline:(NSTimeInterval)rescueDeadline {
    RCTPakta *engine = [self engine];
    // Crash-rescue budget caps every phase; 0 keeps the normal 10min windows.
    NSTimeInterval incrementalDeadline = PaktaMonotonicNow() + 600;
    if (rescueDeadline > 0) {
        incrementalDeadline = MIN(incrementalDeadline, rescueDeadline);
    }
    NSTimeInterval fullDeadline = 0;
    for (const auto &attempt : attempts.elements()) {
        const std::string &type = attempt.Get("type").AsString();
        PaktaType paktaType = type == "diff" ? PaktaTypePatchFromPpk
                            : type == "pdiff" ? PaktaTypePatchFromPackage
                                              : PaktaTypeFullDownload;
        if (paktaType == PaktaTypePatchFromPpk && originHash.length == 0) {
            continue;  // diff patches from the running version; none running
        }
        BOOL isFullAttempt = paktaType == PaktaTypeFullDownload;
        if (isFullAttempt && fullDeadline == 0) {
            // diff/pdiff cannot starve the last-resort full download.
            fullDeadline = PaktaMonotonicNow() + 600;
            if (rescueDeadline > 0) {
                fullDeadline = MIN(fullDeadline, rescueDeadline);
            }
        }
        NSTimeInterval deadline = isFullAttempt ? fullDeadline : incrementalDeadline;
        for (const auto &urlValue : attempt.Get("urls").elements()) {
            NSString *url = PaktaFromStdString(urlValue.AsString());
            if (url == nil) {
                continue;
            }
            NSTimeInterval remaining = deadline - PaktaMonotonicNow();
            if (remaining <= 0) {
                if (isFullAttempt) {
                    return NO;
                }
                break;
            }
            NSMutableDictionary *options =
                [@{
                    @"updateUrl": url,
                    @"hash": hash,
                    @"deadlineUptime": @(deadline),
                } mutableCopy];
            if (paktaType == PaktaTypePatchFromPpk) {
                options[@"originHash"] = originHash;
            }
            dispatch_semaphore_t sem = dispatch_semaphore_create(0);
            __block NSError *resultError = nil;
            [engine performUpdate:paktaType options:options callback:^(NSError *error) {
                resultError = error;
                dispatch_semaphore_signal(sem);
            }];
            if (dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW,
                    (int64_t)(remaining * NSEC_PER_SEC))) != 0) {
                RCTLogWarn(@"RCTPakta -- native check: %s attempt timed out", type.c_str());
                if (isFullAttempt) {
                    return NO;
                }
                break;
            }
            if (resultError == nil) {
                return YES;
            }
            RCTLogInfo(@"RCTPakta -- native check: %s attempt failed: %@",
                       type.c_str(), resultError.localizedDescription);
        }
    }
    return NO;
}

@end
