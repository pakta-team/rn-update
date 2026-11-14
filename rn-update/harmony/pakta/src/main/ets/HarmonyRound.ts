/**
 * [INPUT]: 依赖 RoundHost 注入共享 StepRound、单调时钟和平台 IO，依赖 NativeUpdateResult/ErrorCodes 投影结果
 * [OUTPUT]: 提供 RoundCommand/RoundHost/RoundOutcome 与 runHarmonyRound，执行命令并回传事件
 * [POS]: Harmony 共享轮次执行器；下载持续复核双代际/截止时间，finally 清理 HTTP 与中断标记，不复制核心策略
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { nativeUpdateResult } from './NativeUpdateResult';
import type { NativeUpdateResult } from './NativeUpdateResult';
import { getErrorMessage, parseErrorCodePrefix } from './ErrorCodes';

export interface RoundCommand {
  type: string;
  url: string;
  post: boolean;
  body: string;
  timeoutMs: number;
  callTimeoutMs: number;
  strategy: string;
  hash: string;
  originHash: string;
  deadline: number;
  hashInfo: string;
  activate: boolean;
  cache: string;
  resetGeneration: number;
  configGeneration: number;
  status: string;
  reason: string;
  activated: boolean;
}

export interface RoundHost {
  step(state: string, event: string): string;
  now(): number;
  resetGeneration(): number;
  configGeneration(): number;
  config(): string;
  marker(incomplete: boolean): Promise<void>;
  environment(): Promise<object>;
  http(command: RoundCommand): Promise<string | undefined>;
  installed(hash: string): boolean;
  download(command: RoundCommand, assertCurrent: () => void): Promise<void>;
  cancelHttp(): void;
  commit(command: RoundCommand): Promise<boolean>;
}

export interface RoundOutcome {
  resetGeneration: number;
  configGeneration: number;
  config: string;
  result: NativeUpdateResult;
}

export async function runHarmonyRound(host: RoundHost, deadline: number = 0): Promise<RoundOutcome> {
  const reset = host.resetGeneration();
  const generation = host.configGeneration();
  const config = host.config();
  const cancellation = (): string => host.configGeneration() !== generation
    ? 'config_changed' : host.resetGeneration() !== reset ? 'reset' : '';
  let state = '';
  let marked = false;
  let event: Record<string, unknown> = {
    type: 'start', config, resetGeneration: reset, configGeneration: generation,
    sample: Math.random(), deadline,
  };
  const outcome = (result: NativeUpdateResult): RoundOutcome => ({
    resetGeneration: reset, configGeneration: generation, config, result,
  });
  try {
    while (true) {
      const reason = cancellation();
      if (state && event.type !== 'committed' && reason) event = { type: 'cancel', reason };
      event.now = host.now();
      event.crashHold = false;
      const step = JSON.parse(host.step(state, JSON.stringify(event))) as {
        state: object; commands: RoundCommand[];
      };
      state = JSON.stringify(step.state);
      if (!step.commands.length) throw new Error('Round produced no command');
      for (const command of step.commands) {
        if (command.type === 'finish') {
          return outcome(nativeUpdateResult(command.status, command.reason ?? '',
            command.hash, command.activated));
        }
        if (command.type === 'markIncomplete') {
          marked = true;
          try { await host.marker(true); } catch (_) {}
          continue;
        }
        const reason = cancellation();
        if (reason) {
          event = { type: 'cancel', reason };
          break;
        }
        if (command.type === 'collectEnv') {
          event = { type: 'env', env: await host.environment() };
        } else if (command.type === 'http') {
          const text = await host.http(command);
          event = text === undefined ? { type: 'http' }
            : { type: 'http', text, at: Date.now() / 1000 };
        } else if (command.type === 'checkInstalled') {
          event = { type: 'installed', installed: host.installed(command.hash) };
        } else if (command.type === 'download') {
          let expired = false;
          let timedOut = false;
          const assertCurrent = (): void => {
            if (expired || cancellation() || host.now() >= command.deadline) {
              timedOut = true;
              throw new Error('Install invalidated by round cancellation or deadline');
            }
          };
          let timer: ReturnType<typeof setInterval> | undefined;
          try {
            assertCurrent();
            const stopped = new Promise<void>((_, reject) => {
              timer = setInterval(() => {
                try { assertCurrent(); } catch (error) { reject(error); }
              }, 25);
            });
            await Promise.race([host.download(command, assertCurrent), stopped]);
            event = { type: 'download', ok: true };
          } catch (error) {
            event = timedOut || cancellation()
              ? { type: 'download', timedOut: true }
              : { type: 'download', ok: false,
                code: parseErrorCodePrefix(getErrorMessage(error)) || 'DOWNLOAD_FAILED' };
          } finally {
            expired = true;
            if (timer !== undefined) clearInterval(timer);
          }
        } else if (command.type === 'commit') {
          try {
            const ok = await host.commit(command);
            event = { type: 'committed', ok };
            if (!ok && cancellation()) event.reason = cancellation();
          } catch (_) { event = { type: 'committed', error: true }; }
        } else {
          throw new Error(`Unknown round command: ${command.type}`);
        }
      }
    }
  } finally {
    host.cancelHttp();
    if (marked) {
      try { await host.marker(false); } catch (_) {}
    }
  }
}
