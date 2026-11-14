/**
 * [INPUT]: 依赖主编译单元的 install_record/archive_limits、Foundation、SSZipArchive 与下载空间探测
 * [OUTPUT]: 提供安装记录投影/完整性及激活检查、staging/摘要表和按实际归档长度初始化的解压守卫
 * [POS]: RCTPakta.mm 的共享安装边界片段；保留零字节 marker，累计裁决归 C++，不负责状态提交
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
#include "../../cpp/patch_core/patch_manifest.h"

static NSString *PaktaStagingDirForVersionDir(NSString *versionDir) {
    return [versionDir stringByAppendingString:@(pakta::install_record::kStagingSuffix)];
}

// Parsed completion record (cpp/patch_core/install_record.h): nil when the
// file is absent or malformed; an empty dictionary for the legacy empty
// marker written by SDK < 10.53.
static NSDictionary *PaktaReadInstallRecord(NSString *versionDir) {
    auto record = pakta::install_record::Read(PaktaToStdString(versionDir));
    if (record.state == pakta::install_record::Record::State::kLegacy) {
        return @{};
    }
    if (record.state != pakta::install_record::Record::State::kPresent
        || !record.current_schema || record.version_hash.empty()) {
        return nil;
    }
    return @{ @"schema": @(pakta::install_record::kSchema),
              @"versionHash": [NSString stringWithUTF8String:record.version_hash.c_str()],
              @"bundleSha256": [NSString stringWithUTF8String:record.bundle_sha256.c_str()] };
}

// Whether the directory carries a completion record file at all (the legacy
// empty marker included). Only directories WITHOUT one are grandfathered by
// current/last state in switchVersion; a present record is always verified.
static BOOL PaktaHasInstallRecordFile(NSString *versionDir) {
    return pakta::install_record::HasRecordFile(PaktaToStdString(versionDir));
}

// Presence check (launch / dedup paths, no digest work): bundle present and
// the record exists and, unless legacy-empty, names this version.
static BOOL PaktaHasCompletedVersionAtPath(NSString *versionDir, NSString *hash) {
    return pakta::install_record::IsComplete(PaktaToStdString(versionDir),
        PaktaToStdString(hash), PaktaToStdString(BUNDLE_FILE_NAME));
}

// Activation check: re-hashes the bundle against the record's digest, which
// schema 1 makes mandatory (only the legacy empty marker has none).
// Returns nil when the directory may be activated, the reason otherwise.
static NSString *PaktaVerifyInstallForActivation(NSString *versionDir, NSString *hash) {
    pakta::install_record::Activation passed;
    auto status = pakta::install_record::CheckActivation(PaktaToStdString(versionDir),
        PaktaToStdString(hash), PaktaToStdString(BUNDLE_FILE_NAME), false, &passed);
    return status.ok ? nil : [NSString stringWithUTF8String:status.message.c_str()];
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
@interface PaktaUnzipGuard : NSObject <SSZipArchiveDelegate> {
    pakta::archive_limits::EntryAccumulator _entries{0};
}
@property (nonatomic, copy) NSString *violation;
- (instancetype)initWithArchiveBytes:(long long)archiveBytes;
@end

@implementation PaktaUnzipGuard

- (instancetype)initWithArchiveBytes:(long long)archiveBytes {
    self = [super init];
    if (self) {
        _entries = pakta::archive_limits::EntryAccumulator(archiveBytes);
    }
    return self;
}

- (void)zipArchiveWillUnzipArchiveAtPath:(NSString *)path zipInfo:(unz_global_info)zipInfo {
    auto status = pakta::archive_limits::CheckEntryCount((long long)zipInfo.number_entry);
    if (!status.ok) {
        self.violation = [NSString stringWithUTF8String:status.message.c_str()];
    }
}

- (BOOL)zipArchiveShouldUnzipFileAtIndex:(NSInteger)fileIndex
                              totalFiles:(NSInteger)totalFiles
                             archivePath:(NSString *)archivePath
                                fileInfo:(unz_file_info)fileInfo {
    if (self.violation != nil) {
        return NO;
    }
    auto status = _entries.Accept((long long)fileInfo.uncompressed_size,
        (long long)fileInfo.compressed_size,
        ((fileInfo.external_fa >> 16) & S_IFMT) == S_IFLNK, "");
    if (!status.ok) {
        self.violation = [NSString stringWithUTF8String:status.message.c_str()];
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
    if (self.violation == nil && pakta::archive_limits::IsReservedEntryName(PaktaToStdString(unzippedFilePath))) {
        self.violation = @"archive contains reserved entry";
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
