/**
 * [INPUT]: 依赖 core 的启动身份与原生桥、注入的 ProcessState 和 Reporter，动态调用 Pakta 门面的钩子与上报
 * [OUTPUT]: 对外提供 Activation，执行成功确认单飞、已下载版本切换、重启与重置
 * [POS]: src 的激活副作用边界；保留 expectedHash 原生门卫，以共享任务身份隔离 reset 前的晚结果，切包沿用独立代际与 watchdog
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { Pakta } from './client';
import type { Reporter } from './clientReporter';
import type { ProcessState } from './clientState';
import {
  currentVersion,
  currentVersionInfo,
  isFirstTime,
  PaktaModule,
} from './core';
import { toUpdateError, UpdateError } from './error';
import type { BeforeReloadContext } from './type';
import { assertWeb, log, warn } from './utils';

type ActivationHost = Pick<
  Pakta,
  | 'options'
  | 't'
  | 'assertDebug'
  | 'report'
  | 'throwIfEnabled'
  | 'runBeforeReload'
  | 'restartApp'
>;

export class Activation {
  constructor(
    private readonly host: ActivationHost,
    private readonly reporter: Reporter,
    private readonly state: ProcessState
  ) {}

  private assertHash = (hash: string) => {
    if (!this.state.shared.downloadedHash) {
      log(`no downloaded hash yet, ignore switch to ${hash}`);
      return;
    }
    if (hash !== this.state.shared.downloadedHash) {
      log(`use downloaded hash ${this.state.shared.downloadedHash} first`);
      return;
    }
    return true;
  };

  runBeforeReload = async (context: BeforeReloadContext) => {
    const { beforeReload } = this.host.options;
    if (!beforeReload) {
      return true;
    }
    const shouldReload = await beforeReload(context);
    if (shouldReload === false) {
      log('beforeReload returned false, skipping reload');
      return false;
    }
    return true;
  };

  markSuccess = (): Promise<boolean | undefined> => {
    if (this.state.markSuccessTask) {
      return this.state.markSuccessTask;
    }
    if (this.state.shared.marked) {
      log('markSuccess skipped: already marked');
      return Promise.resolve(undefined);
    }
    if (__DEV__) {
      log('markSuccess skipped: development build');
      return Promise.resolve(undefined);
    }
    if (!isFirstTime) {
      warn('markSuccess skipped: native launch marker is false', {
        expectedHash: currentVersion,
      });
      return Promise.resolve(undefined);
    }
    let resolve!: (value: boolean | undefined) => void;
    let reject!: (error: unknown) => void;
    const task = new Promise<boolean | undefined>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.state.markSuccessTask = task;
    const clearTask = () => {
      if (this.state.markSuccessTask === task) {
        this.state.markSuccessTask = undefined;
      }
    };
    void this.performMarkSuccess(task).then(
      (value) => {
        clearTask();
        resolve(value);
      },
      (error: unknown) => {
        clearTask();
        reject(error);
      }
    );
    return task;
  };

  private performMarkSuccess = async (
    task: Promise<boolean | undefined>
  ): Promise<boolean> => {
    try {
      const accepted = await Promise.resolve(
        PaktaModule.markSuccess(currentVersion)
      );
      if (this.state.markSuccessTask !== task) {
        return false;
      }
      if (!accepted) {
        warn('markSuccess rejected by native', {
          expectedHash: currentVersion,
        });
        return false;
      }
    } catch (e) {
      if (this.state.markSuccessTask !== task) {
        return false;
      }
      const err = toUpdateError(e, 'MARK_SUCCESS_FAILED');
      this.reporter.emitError(err, 'errorMarkSuccess');
      throw err;
    }
    this.state.shared.marked = true;
    this.host.report({ type: 'markSuccess' });
    if (currentVersionInfo.forceBootRescue) {
      this.host.report({ type: 'forceBootRescue' });
    }
    if (currentVersionInfo.crashRescue) {
      this.host.report({ type: 'crashRescue' });
    }
    return true;
  };

  getDownloadedHash = (): string | undefined =>
    this.state.shared.downloadedHash;

  switchVersion = async (hash: string): Promise<boolean> => {
    if (!this.host.assertDebug('switchVersion()')) {
      return false;
    }
    if (!this.assertHash(hash)) {
      return false;
    }
    if (this.state.shared.applyingUpdate) {
      log(`switchVersion: ${hash} ignored, a switch is already in progress`);
      return false;
    }
    log(`switchVersion: ${hash}`);
    const applyingGeneration = this.state.beginApplyingUpdate();
    try {
      if (!(await this.host.runBeforeReload({ type: 'switchVersion', hash }))) {
        this.state.finishApplyingUpdate(applyingGeneration);
        return false;
      }
    } catch (e) {
      this.state.finishApplyingUpdate(applyingGeneration);
      const err = toUpdateError(e, 'USER_HOOK_ERROR');
      this.reporter.emitError(err, 'errorSwitchVersion', {
        data: { newVersion: hash },
      });
      throw err;
    }
    if (!this.state.ownsApplyingUpdate(applyingGeneration)) {
      return false;
    }
    try {
      await PaktaModule.reloadUpdate({ hash });
    } catch (e) {
      this.state.finishApplyingUpdate(applyingGeneration);
      const err = toUpdateError(e, 'SWITCH_VERSION_FAILED');
      this.reporter.emitError(err, 'errorSwitchVersion', {
        data: { newVersion: hash },
      });
      throw err;
    }
    this.state.armReloadWatchdog(applyingGeneration, () => {
      this.host.report({
        type: 'errorSwitchVersion',
        code: 'RESTART_FAILED',
        message: 'reloadUpdate resolved but the app did not restart',
        data: { newVersion: hash },
      });
    });
    return true;
  };

  switchVersionLater = async (hash: string) => {
    if (!this.host.assertDebug('switchVersionLater()')) {
      return;
    }
    if (this.assertHash(hash)) {
      log(`switchVersionLater: ${hash}`);
      try {
        return await PaktaModule.setNeedUpdate({ hash });
      } catch (e) {
        const err = toUpdateError(e, 'SWITCH_VERSION_FAILED');
        this.reporter.emitError(err, 'errorSwitchVersion', {
          data: { newVersion: hash },
        });
        throw err;
      }
    }
  };

  restartApp = async () => {
    try {
      if (!(await this.host.runBeforeReload({ type: 'restartApp' }))) {
        return;
      }
    } catch (e) {
      const err = toUpdateError(e, 'USER_HOOK_ERROR');
      this.reporter.emitError(err, 'errorRestart');
      throw err;
    }
    try {
      return await PaktaModule.restartApp();
    } catch (e) {
      const err = toUpdateError(e, 'RESTART_FAILED');
      this.reporter.emitError(err, 'errorRestart');
      throw err;
    }
  };

  resetToPackagedBundle = async (options?: {
    restart?: boolean;
  }): Promise<boolean> => {
    if (!assertWeb()) {
      return false;
    }
    if (typeof PaktaModule.resetToPackagedBundle !== 'function') {
      const err = new UpdateError(
        this.host.t('error_reset_not_supported'),
        'RESET_FAILED'
      );
      this.reporter.emitError(err, 'errorReset');
      this.host.throwIfEnabled(err);
      return false;
    }
    try {
      await PaktaModule.resetToPackagedBundle();
    } catch (e) {
      const err = toUpdateError(e, 'RESET_FAILED');
      this.reporter.emitError(err, 'errorReset');
      this.host.throwIfEnabled(err);
      return false;
    }
    this.state.shared.downloadedHash = undefined;
    this.state.shared.toHash = undefined;
    this.state.shared.marked = false;
    this.state.markSuccessTask = undefined;
    this.state.invalidateApplyingUpdate();
    this.state.shared.apkStatus = null;
    this.host.report({ type: 'reset' });
    if (options?.restart) {
      try {
        await this.host.restartApp();
      } catch (e: any) {
        log('restart after reset failed:', e?.message || e);
      }
    }
    return true;
  };
}
