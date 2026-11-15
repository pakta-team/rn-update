/**
 * [INPUT]: 依赖主编译单元文件队列、SSZipArchive、PaktaUnzipGuard、共享目录审计与旧版本清理
 * [OUTPUT]: 实现目录/备份排除、解压审计、sidecar 清理与保护运行版本的回收
 * [POS]: RCTPakta.mm 的平台文件执行片段；实际 archiveBytes 同时送条目守卫与解压后审计，不改共享算法
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
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
#if !TARGET_OS_TV  // tvOS stores under Caches, which is never backed up.
    NSURL *url = [NSURL fileURLWithPath:path isDirectory:YES];
    NSError *error = nil;
    if (![url setResourceValue:@YES
                        forKey:NSURLIsExcludedFromBackupKey
                         error:&error]) {
        RCTLogWarn(@"Pakta exclude from backup error: %@", error.localizedDescription);
    }
#endif
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

        PaktaUnzipGuard *guard = [[PaktaUnzipGuard alloc] initWithArchiveBytes:archiveBytes];
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
            if (unzipError == nil) {
                auto audit = pakta::archive_limits::CheckExtractedDirectory(
                    PaktaToStdString(destination), archiveBytes);
                if (!audit.ok) {
                    unzipError = PaktaNSErrorFromStatus(audit);
                }
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
