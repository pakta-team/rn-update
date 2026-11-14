/**
 * [INPUT]: 依赖 Harmony HTTP/设备时钟、UpdateContext 的持久配置/双代际与共享轮次执行器
 * [OUTPUT]: 提供冷启动调度、JS 检查完成信号与可选等待期限的 checkAndUpdateNative；超时返回 failed/timeout 而不取消共享轮次
 * [POS]: Harmony 无 JS 检查的单飞与 IO 边界；调用方等待不拥有轮次，提交及完成快照仍复核配置/reset 代际
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import http from '@ohos.net.http';
import deviceInfo from '@ohos.deviceInfo';
import logger from './Logger';
import NativePatchCore from './NativePatchCore';
import type { UpdateContext } from './UpdateContext';
import { NativeUpdateRound, nativeUpdateResult } from './NativeUpdateResult';
import type { NativeUpdateResult } from './NativeUpdateResult';
import { runHarmonyRound } from './HarmonyRound';
import type { RoundCommand, RoundOutcome } from './HarmonyRound';
import { monotonicNowMs } from './MonotonicClock';
import { getErrorMessage } from './ErrorCodes';

const TAG = 'NativeCheck';
export const KEY_CONFIG = 'nativeConfig';
export const KEY_RESP_CACHE = 'nativeCheckResp';
export const KEY_ROUND_INCOMPLETE = 'nativeCheckIncomplete';
const START_DELAY_MS = 5000;
const DEFAULT_HOST_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_CHECK_HTTP_ATTEMPTS = 8;
let scheduledContext: UpdateContext | undefined;
let scheduledRollback = '';
let jsCompletedConfig: string | undefined;
let outcome: RoundOutcome | undefined;
const hostRound = new NativeUpdateRound();

function configurationError(context: UpdateContext): NativeUpdateResult | undefined {
  const config = NativePatchCore.runnableConfig(context.getKv(KEY_CONFIG) || '');
  return config ? JSON.parse(config) as NativeUpdateResult : undefined;
}

function startNativeRound(context: UpdateContext, rollback: string): Promise<NativeUpdateResult> {
  const error = configurationError(context);
  if (error) return Promise.resolve(error);
  return hostRound.run(async () => {
    let activeHttp: http.HttpRequest | undefined;
    let httpAttempts = 0;
    try {
      outcome = await runHarmonyRound({
        step: (state, event) => NativePatchCore.stepRound(state, event),
        now: monotonicNowMs,
        resetGeneration: () => context.getResetGeneration(),
        configGeneration: () => context.getNativeConfigGeneration(),
        config: () => context.getKv(KEY_CONFIG),
        marker: incomplete => incomplete ? context.setKv(KEY_ROUND_INCOMPLETE, '1')
          : context.removeKv(KEY_ROUND_INCOMPLETE),
        environment: async () => ({
          packageVersion: context.getPackageVersion(), currentVersion: context.getCurrentVersion(),
          rolledBackVersion: rollback, uuid: context.getKv('uuid'), channel: context.getChannel(),
          buildTime: context.getBuildTime(), os: `harmony ${deviceInfo.osFullName}`,
          bundleHash: await context.getBundleHash(),
        }),
        http: async command => {
          if (httpAttempts++ >= MAX_CHECK_HTTP_ATTEMPTS) return undefined;
          const reset = context.getResetGeneration();
          const generation = context.getNativeConfigGeneration();
          const client = http.createHttp();
          activeHttp = client;
          let timer = 0;
          let watcher = 0;
          try {
            const stopped = new Promise<http.HttpResponse>((_, reject) => {
              timer = setTimeout(() => reject(new Error('HTTP whole-call timeout')), command.callTimeoutMs);
              watcher = setInterval(() => {
                if (context.getResetGeneration() !== reset || context.getNativeConfigGeneration() !== generation) {
                  reject(new Error('HTTP round cancelled'));
                  client.destroy();
                }
              }, 25);
            });
            const response = await Promise.race([client.request(command.url, {
              method: command.post ? http.RequestMethod.POST : http.RequestMethod.GET,
              header: command.post ? { Accept: 'application/json', 'Content-Type': 'application/json' }
                : { Accept: 'application/json' },
              extraData: command.post ? command.body : undefined,
              connectTimeout: command.timeoutMs, readTimeout: command.timeoutMs,
              expectDataType: http.HttpDataType.STRING,
            }), stopped]);
            return response.responseCode >= 200 && response.responseCode < 300 && typeof response.result === 'string'
              ? response.result : undefined;
          } catch (_) { return undefined; }
          finally {
            clearTimeout(timer); clearInterval(watcher);
            activeHttp = undefined;
            client.destroy();
          }
        },
        installed: hash => context.hasDownloadedVersion(hash),
        download: (command, assertCurrent) => context.downloadNativeRound(command.strategy,
          command.url, command.hash, command.originHash || '', command.deadline, assertCurrent),
        cancelHttp: () => { activeHttp?.destroy(); },
        commit: (command: RoundCommand) => context.commitNativeCheckResult(command.resetGeneration,
          command.hash, command.hashInfo, command.activate, command.cache, command.configGeneration),
      });
      return outcome.result;
    } catch (error) {
      logger.error(TAG, `native check failed: ${getErrorMessage(error)}`);
      return nativeUpdateResult('failed', 'internal_error');
    }
  });
}

export async function checkAndUpdateNative(context: UpdateContext, timeoutMs: number = DEFAULT_HOST_TIMEOUT_MS): Promise<NativeUpdateResult> {
  if (scheduledContext !== context) return nativeUpdateResult('skipped', 'not_initialized');
  const error = configurationError(context);
  if (error) return error;
  const config = context.getKv(KEY_CONFIG);
  const round = startNativeRound(context, scheduledRollback);
  let result: NativeUpdateResult;
  let timer = 0;
  try {
    const waitMs = Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : DEFAULT_HOST_TIMEOUT_MS;
    const expired = new Promise<undefined>(resolve => {
      timer = setTimeout(() => resolve(undefined), waitMs);
    });
    const settled = await Promise.race([round, expired]);
    if (settled === undefined) return nativeUpdateResult('failed', 'timeout');
    result = settled;
  } finally {
    clearTimeout(timer);
  }
  if (outcome) {
    const reason = NativePatchCore.hostCancellation(config, outcome.config, context.getKv(KEY_CONFIG),
      outcome.configGeneration, context.getNativeConfigGeneration(),
      outcome.resetGeneration, context.getResetGeneration());
    if (reason) return nativeUpdateResult('cancelled', reason);
  }
  return nativeUpdateResult(result.status, result.reason, result.hash, result.activated);
}

export function markJsCheckCompleted(config: string): void { jsCompletedConfig = config; }

export function scheduleNativeCheck(context: UpdateContext, rollback: string): void {
  if (scheduledContext) return;
  scheduledContext = context;
  scheduledRollback = rollback;
  setTimeout(() => {
    if (jsCompletedConfig !== undefined && jsCompletedConfig === context.getKv(KEY_CONFIG)) return;
    startNativeRound(context, rollback).catch((error: Object) => {
      logger.error(TAG, getErrorMessage(error));
    });
  }, context.getKv(KEY_ROUND_INCOMPLETE) ? 0 : START_DELAY_MS);
}
