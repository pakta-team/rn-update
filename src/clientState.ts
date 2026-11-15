/**
 * [INPUT]: 依赖 react-native 的订阅类型、type 的进度契约和宿主定时器，不依赖原生桥或客户端实例
 * [OUTPUT]: 对外提供 SharedState、ProcessState 与 createProcessState 工厂，分配下载容器、成功确认任务和切包代际及 watchdog
 * [POS]: src 的进程状态所有者；由 client 求值时创建并注入下载与激活模块，确认任务身份随 reset 失效且不影响独立切包代际
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { EmitterSubscription } from 'react-native';
import type { ProgressData } from './type';

const RELOAD_WATCHDOG_MS = 5000;

export interface SharedState {
  progressHandlers: Record<string, EmitterSubscription>;
  downloadingTasks: Record<string, Promise<string | undefined>>;
  progressCallbacks: Record<string, Set<(data: ProgressData) => void>>;
  downloadedHash?: string;
  toHash?: string;
  apkStatus: 'downloading' | 'downloaded' | null;
  marked: boolean;
  applyingUpdate: boolean;
}

export const createProcessState = () => {
  const shared: SharedState = {
    progressHandlers: {},
    downloadingTasks: {},
    progressCallbacks: {},
    downloadedHash: undefined,
    apkStatus: null,
    marked: false,
    applyingUpdate: false,
  };
  let applyingUpdateGeneration = 0;
  let reloadWatchdogTimer: ReturnType<typeof setTimeout> | undefined;
  const clearReloadWatchdog = () => {
    if (reloadWatchdogTimer !== undefined) {
      clearTimeout(reloadWatchdogTimer);
      reloadWatchdogTimer = undefined;
    }
  };
  const ownsApplyingUpdate = (generation: number): boolean =>
    generation === applyingUpdateGeneration && shared.applyingUpdate;
  return {
    shared,
    markSuccessTask: undefined as Promise<boolean | undefined> | undefined,
    beginApplyingUpdate: (): number => {
      clearReloadWatchdog();
      shared.applyingUpdate = true;
      return ++applyingUpdateGeneration;
    },
    ownsApplyingUpdate,
    finishApplyingUpdate: (generation: number): boolean => {
      if (!ownsApplyingUpdate(generation)) {
        return false;
      }
      clearReloadWatchdog();
      shared.applyingUpdate = false;
      return true;
    },
    invalidateApplyingUpdate: () => {
      applyingUpdateGeneration++;
      clearReloadWatchdog();
      shared.applyingUpdate = false;
    },
    armReloadWatchdog: (generation: number, onTimeout: () => void) => {
      if (!ownsApplyingUpdate(generation)) {
        return;
      }
      clearReloadWatchdog();
      const timer = setTimeout(() => {
        if (reloadWatchdogTimer !== timer || !ownsApplyingUpdate(generation)) {
          return;
        }
        reloadWatchdogTimer = undefined;
        shared.applyingUpdate = false;
        onTimeout();
      }, RELOAD_WATCHDOG_MS);
      reloadWatchdogTimer = timer;
    },
  };
};

export type ProcessState = ReturnType<typeof createProcessState>;
