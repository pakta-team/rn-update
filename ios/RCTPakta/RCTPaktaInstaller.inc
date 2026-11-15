/**
 * [INPUT]: 依赖主编译单元的下载登记/文件队列、RCTPaktaDownloader 与共享 manifest/补丁/Seal/Promote
 * [OUTPUT]: 实现 full/diff/pdiff 下载安装和重载入口，失败清理 staging，晋升时保护运行/current/last 版本
 * [POS]: RCTPakta.mm 的安装编排片段；网络与队列仍归平台，不独立编译或扩大宿主 API
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
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
            __block NSError *finalError = error;
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
                auto sealed = pakta::install_record::Seal(PaktaToStdString(staging),
                    PaktaToStdString(hash), PaktaToStdString(BUNDLE_FILE_NAME),
                    PaktaToStdString(artifactSha256));
                if (!sealed.status.ok) {
                    finalError = PaktaErrorWithCode(sealed.file_failure
                        ? pakta::error_codes::kFileOperationFailed : pakta::error_codes::kPatchFailed,
                        PaktaFromStdString(sealed.status.message));
                } else {
                    PaktaWithStateLock(^{
                        auto state = PaktaStateFromDefaults(PaktaDefaults());
                        auto target = PaktaToStdString(hash);
                        if (target == state.current_version || target == state.last_version
                            || [hash isEqualToString:paktaLaunchVersion]) {
                            finalError = PaktaErrorWithCode(pakta::error_codes::kFileOperationFailed,
                                @"cannot replace protected version");
                            return;
                        }
                        NSError *removeError = nil;
                        if ([fileManager fileExistsAtPath:unzipDir]
                            && ![fileManager removeItemAtPath:unzipDir error:&removeError]) {
                            finalError = PaktaErrorWithCode(pakta::error_codes::kFileOperationFailed,
                                removeError.localizedDescription);
                            return;
                        }
                        auto promoted = pakta::install_record::Promote(
                            PaktaToStdString(staging), PaktaToStdString(unzipDir));
                        if (!promoted.ok) {
                            finalError = PaktaErrorWithCode(pakta::error_codes::kFileOperationFailed,
                                PaktaFromStdString(promoted.message));
                        }
                    });
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

    pakta::patch::PatchManifest manifest;
    std::string hbcTransform;
    pakta::patch::PatchManifestOptions manifestOptions;
    manifestOptions.bundle_patch_entry_name = PaktaToStdString(BUNDLE_PATCH_NAME);
    auto manifestStatus = pakta::patch::ParsePatchManifest(
        std::string(static_cast<const char *>(data.bytes), data.length),
        manifestOptions, &manifest, &hbcTransform);
    if (!manifestStatus.ok) {
        callback(PaktaNSErrorFromStatus(manifestStatus));
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

    options.bundle_hbc_transform_meta = hbcTransform;

    pakta::patch::Status status = pakta::patch::ApplyPatchFromFileSource(options);
    if (!status.ok) {
        callback(PaktaNSErrorFromStatus(status));
        return;
    }

    callback(nil);
}
