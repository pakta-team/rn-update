/**
 * [INPUT]: 依赖 core 原生下载桥、updateFlowCore 的下载决策、镜像与进度工具，以及注入的 ProcessState 和 Reporter
 * [OUTPUT]: 对外提供 Downloader，编排下载去重、进度广播、镜像与补丁降级及 APK 安装
 * [POS]: src 的制品准备边界；下载成功等待门面报告后持久化版本信息并发布 downloadedHash，不负责激活与重启
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { DeviceEventEmitter, Platform } from 'react-native';
import type { Pakta } from './client';
import type { Reporter } from './clientReporter';
import type { ProcessState } from './clientState';
import {
  currentVersion,
  PaktaModule,
  paktaNativeEventEmitter,
  rolledBackVersion,
  setLocalHashInfo,
} from './core';
import { readErrorCode, toUpdateError, UpdateError } from './error';
import type { CheckResult, ProgressData } from './type';
import {
  type DownloadPlan,
  type DownloadStrategyType,
  decideDownload,
  isMirrorRetryableCode,
} from './updateFlowCore';
import { computeProgress, log, testUrls, warn } from './utils';

type DownloadHost = Pick<
  Pakta,
  'options' | 't' | 'report' | 'reportInvalidUpdateOnce' | 'throwIfEnabled'
>;

export class Downloader {
  constructor(
    private readonly host: DownloadHost,
    private readonly reporter: Reporter,
    private readonly state: ProcessState
  ) {}

  downloadUpdate = async (
    updateInfo: CheckResult,
    onDownloadProgress?: (data: ProgressData) => void
  ) => {
    if (
      this.host.options.beforeDownloadUpdate &&
      (await this.host.options.beforeDownloadUpdate(updateInfo)) === false
    ) {
      log('beforeDownloadUpdate returned false, skipping download');
      return;
    }
    const decision = decideDownload(
      updateInfo,
      { currentVersion, rolledBackVersion },
      __DEV__
    );
    if (decision.action === 'none') {
      if (decision.reason === 'alreadyCurrent') {
        log(`current hash ${currentVersion}, ignored`);
      } else if (decision.reason === 'rolledBack') {
        log(`rolledback hash ${rolledBackVersion}, ignored`);
      } else if (decision.reason === 'noArtifact') {
        this.host.reportInvalidUpdateOnce('noArtifact', updateInfo.hash || '');
      }
      return;
    }
    const { hash } = decision;
    const sharedState = this.state.shared;
    if (sharedState.downloadedHash === hash) {
      log(`duplicated downloaded hash ${sharedState.downloadedHash}, ignored`);
      return sharedState.downloadedHash;
    }
    const existingTask = sharedState.downloadingTasks[hash];
    if (existingTask) {
      log(`download for hash ${hash} already in progress, reusing it`);
      if (onDownloadProgress) {
        sharedState.progressCallbacks[hash]?.add(onDownloadProgress);
      }
      return existingTask;
    }
    const task = this.performDownload(updateInfo, decision, onDownloadProgress);
    sharedState.downloadingTasks[hash] = task;
    try {
      return await task;
    } finally {
      delete sharedState.downloadingTasks[hash];
    }
  };

  private rankDownloadUrls = async (urls?: string[]): Promise<string[]> => {
    if (!urls?.length) {
      return [];
    }
    const winner = await testUrls(urls);
    const ordered: string[] = [];
    const push = (url?: string | null) => {
      if (url && !ordered.includes(url)) {
        ordered.push(url);
      }
    };
    push(winner);
    for (const url of urls) {
      push(url);
    }
    return ordered;
  };

  private performDownload = async (
    updateInfo: CheckResult,
    plan: DownloadPlan,
    onDownloadProgress?: (data: ProgressData) => void
  ) => {
    const { name, description = '', metaInfo } = updateInfo;
    const { hash, attempts, devNoop } = plan;
    if (devNoop) {
      log(this.host.t('dev_incremental_update_disabled'));
      return;
    }
    const sharedState = this.state.shared;
    const patchStartTime = Date.now();
    const progressCallbacks = new Set<(data: ProgressData) => void>();
    if (onDownloadProgress) {
      progressCallbacks.add(onDownloadProgress);
    }
    sharedState.progressCallbacks[hash] = progressCallbacks;
    const dispatchProgress = (data: ProgressData) => {
      const callbacks = sharedState.progressCallbacks[hash];
      if (!callbacks || callbacks.size === 0) {
        return;
      }
      const payload = {
        ...data,
        progress: computeProgress(data.received, data.total),
      };
      callbacks.forEach((callback) => {
        try {
          callback(payload);
        } catch (e) {
          warn('onDownloadProgress callback threw', e);
        }
      });
    };
    const onNativeProgress = (event: unknown) => {
      const progressData = event as ProgressData;
      if (progressData.hash === hash) {
        dispatchProgress(progressData);
      }
    };
    if ((Platform.OS as string) === 'harmony') {
      sharedState.progressHandlers[hash] = DeviceEventEmitter.addListener(
        'RCTPaktaDownloadProgress',
        onNativeProgress
      );
    } else {
      sharedState.progressHandlers[hash] = paktaNativeEventEmitter.addListener(
        'RCTPaktaDownloadProgress',
        onNativeProgress
      );
    }
    const maxRetries = Math.max(
      0,
      Math.floor(this.host.options.maxRetries ?? 3)
    );
    let succeeded = '';
    let lastError: UpdateError | undefined;
    const errorMessages: string[] = [];
    const exhaustedStrategies = new Map<DownloadStrategyType, string>();
    let patchFailed = false;
    const runners: Record<
      DownloadStrategyType,
      (url: string) => Promise<void>
    > = {
      diff: (url) =>
        PaktaModule.downloadPatchFromPpk({
          updateUrl: url,
          hash,
          originHash: currentVersion,
        }),
      pdiff: (url) =>
        PaktaModule.downloadPatchFromPackage({ updateUrl: url, hash }),
      full: (url) => PaktaModule.downloadFullUpdate({ updateUrl: url, hash }),
    };
    const errorKeys = {
      diff: 'error_diff_failed',
      pdiff: 'error_pdiff_failed',
      full: 'error_full_patch_failed',
    } as const;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const backoffMs = Math.round(
          Math.min(1000 * 2 ** (attempt - 1), 10000) *
            (0.75 + Math.random() * 0.5)
        );
        log(`retry attempt ${attempt}/${maxRetries}, waiting ${backoffMs}ms`);
        await new Promise<void>((r) => setTimeout(() => r(), backoffMs));
        errorMessages.length = 0;
        errorMessages.push(...exhaustedStrategies.values());
        lastError = undefined;
        succeeded = '';
      }
      this.host.report({
        type: 'downloading',
        data: { newVersion: hash, attempt },
      });
      for (const { type, urls } of attempts) {
        if (succeeded) {
          break;
        }
        if (exhaustedStrategies.has(type)) {
          continue;
        }
        const orderedUrls = await this.rankDownloadUrls(urls);
        for (const url of orderedUrls) {
          log(`downloading ${type} from ${url}`);
          try {
            await runners[type](url);
            succeeded = type;
            break;
          } catch (e: unknown) {
            const { code, message } = readErrorCode(e);
            const errorMessage = this.host.t(errorKeys[type], {
              message: message || String(e ?? ''),
            });
            errorMessages.push(errorMessage);
            lastError = new UpdateError(
              errorMessage,
              code ?? 'DOWNLOAD_FAILED',
              { cause: e }
            );
            log(errorMessage);
            if (lastError.code === 'PATCH_FAILED') {
              patchFailed = true;
            }
            if (!isMirrorRetryableCode(lastError.code)) {
              exhaustedStrategies.set(type, errorMessage);
              break;
            }
          }
        }
      }
      if (
        succeeded ||
        attempts.every(({ type }) => exhaustedStrategies.has(type))
      ) {
        break;
      }
    }
    if (sharedState.progressHandlers[hash]) {
      sharedState.progressHandlers[hash].remove();
      delete sharedState.progressHandlers[hash];
    }
    delete sharedState.progressCallbacks[hash];
    if (succeeded && errorMessages.length > 0) {
      this.host.report({
        type: 'downloadFallback',
        code: patchFailed ? 'PATCH_FAILED' : lastError?.code,
        data: { newVersion: hash, succeeded },
        message: errorMessages.join(';'),
      });
    }
    if (!succeeded) {
      const message = errorMessages.join(';');
      if (lastError) {
        const err = toUpdateError(lastError, 'DOWNLOAD_FAILED');
        this.reporter.emitError(err, 'errorUpdate', {
          message,
          data: { newVersion: hash },
        });
        throw err;
      }
      this.host.report({
        type: 'errorUpdate',
        data: { newVersion: hash },
        message,
      });
      return;
    } else {
      const duration = Date.now() - patchStartTime;
      const data: Record<string, any> = {
        newVersion: hash,
        diff: succeeded,
        duration,
      };
      if (errorMessages.length > 0) {
        data.error = errorMessages.join(';');
      }
      await this.host.report({ type: 'downloadSuccess', data });
    }
    log(`downloaded ${succeeded} hash:`, hash);
    const hashInfo: Record<string, any> = { name, description, metaInfo };
    if (sharedState.toHash === hash) {
      hashInfo.debugChannel = true;
    }
    try {
      await setLocalHashInfo(hash, hashInfo);
    } catch (e: any) {
      const err = toUpdateError(e, 'FILE_OPERATION_FAILED');
      this.reporter.emitError(err, 'errorUpdate', {
        message: err.message,
        data: { newVersion: hash },
      });
      throw err;
    }
    sharedState.downloadedHash = hash;
    return hash;
  };

  downloadAndInstallApk = async (
    url: string,
    onDownloadProgress?: (data: ProgressData) => void
  ) => {
    if (Platform.OS !== 'android') {
      return;
    }
    const sharedState = this.state.shared;
    if (sharedState.apkStatus === 'downloading') {
      return;
    }
    if (sharedState.apkStatus === 'downloaded') {
      const err = new UpdateError(
        this.host.t('error_apk_pending_install'),
        'APK_INSTALL_PENDING'
      );
      this.reporter.emitError(err, 'errorInstallApk');
      this.host.throwIfEnabled(err);
      return;
    }
    sharedState.apkStatus = 'downloading';
    this.host.report({ type: 'downloadingApk' });
    const progressKey = 'downloadingApk';
    if (onDownloadProgress) {
      if (sharedState.progressHandlers[progressKey]) {
        sharedState.progressHandlers[progressKey].remove();
      }
      sharedState.progressHandlers[progressKey] =
        paktaNativeEventEmitter.addListener(
          'RCTPaktaDownloadProgress',
          (event: unknown) => {
            const progressData = event as ProgressData;
            if (progressData.hash === progressKey) {
              onDownloadProgress(progressData);
            }
          }
        );
    }
    try {
      await PaktaModule.downloadAndInstallApk({
        url,
        target: 'update.apk',
        hash: progressKey,
      });
      sharedState.apkStatus = 'downloaded';
    } catch (e) {
      sharedState.apkStatus = null;
      const err = toUpdateError(e, 'APK_DOWNLOAD_FAILED');
      this.reporter.emitError(err, 'errorDownloadAndInstallApk', {
        message: err.message || this.host.t('error_apk_download_failed'),
      });
      this.host.throwIfEnabled(err);
    } finally {
      if (sharedState.progressHandlers[progressKey]) {
        sharedState.progressHandlers[progressKey].remove();
        delete sharedState.progressHandlers[progressKey];
      }
    }
  };
}
