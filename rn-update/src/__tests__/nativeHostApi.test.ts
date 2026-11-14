/**
 * [INPUT]: 依赖 bun:test、node:fs/node:vm，VM 隔离运行真实 Harmony NativeCheckOrchestrator.ts，仅替换平台导入与 HTTP/下载 IO
 * [OUTPUT]: 提供 checkAndUpdate 状态映射、独立宿主等待期限、超时后共享轮继续、双代际零提交与延迟检查单飞的回归断言
 * [POS]: __tests__ 的无桥宿主 API 套件，锁定编排器入口/调度/配置门/结果映射；含本地 pakta 扩展的 getChannel 空实现
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { runHarmonyRound } from '../../harmony/pakta/src/main/ets/HarmonyRound';
import type { NativeUpdateResult } from '../../harmony/pakta/src/main/ets/NativeUpdateResult';
import {
  NativeUpdateRound,
  nativeUpdateResult,
} from '../../harmony/pakta/src/main/ets/NativeUpdateResult';

// Evaluate the actual Harmony orchestrator in an isolated VM per test. Only
// platform imports, HTTP and download IO are substituted; entry points,
// scheduling, configuration gates, result mapping and reset checks are real.
const source = readFileSync(
  new URL(
    '../../harmony/pakta/src/main/ets/NativeCheckOrchestrator.ts',
    import.meta.url
  ),
  'utf8'
)
  .replace(/^import[\s\S]*?;\r?\n/gm, '')
  .replace(/^export /gm, '');
const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(source);

interface Decision {
  action: string;
  reason?: string;
  hash?: string;
  activate?: boolean;
}

function harness() {
  const values = new Map<string, string>();
  values.set('nativeConfig', JSON.stringify({ appKey: 'test-app' }));
  const timers: Array<() => void> = [];
  const pendingTimers = new Map<
    number,
    { callback: () => void; delay: number }
  >();
  let nextTimer = 0;
  const state = {
    generation: 0,
    configGeneration: 0,
    checks: 0,
    downloads: 0,
    commits: 0,
    downloadOK: true,
    commitOK: true,
    installed: false,
    reachable: true,
    decision: { action: 'none', reason: 'up_to_date' } as Decision,
    beforeResponse: async (): Promise<void> => {},
  };
  const context = {
    getKv: (key: string) => values.get(key),
    setKv: async (key: string, value: string) => {
      values.set(key, value);
    },
    removeKv: async (key: string) => {
      values.delete(key);
    },
    getResetGeneration: () => state.generation,
    getNativeConfigGeneration: () => state.configGeneration,
    getCurrentVersion: () => '',
    getPackageVersion: () => '1.0',
    // 本地 pakta 扩展：上游无 channel 概念，但合并后的编排器读取它。
    getChannel: () => '',
    getBuildTime: () => '123',
    getBundleHash: async () => 'binary-hash',
    hasDownloadedVersion: () => state.installed,
    downloadNativeRound: async () => {
      state.downloads += 1;
      if (!state.downloadOK) throw new Error('[DOWNLOAD_FAILED] network');
    },
    getBundleUrl: () => {
      throw new Error('host checks must not resolve the launch bundle again');
    },
    commitNativeCheckResult: async (generation: number) => {
      state.commits += 1;
      return generation === state.generation && state.commitOK;
    },
  };
  const runtime = runInNewContext(
    `${javascript}\n({ check: checkAndUpdateNative, schedule: scheduleNativeCheck });`,
    {
      NativeUpdateRound,
      nativeUpdateResult,
      runHarmonyRound,
      monotonicNowMs: () => 1000,
      clearTimeout: (id: number) => pendingTimers.delete(id),
      setInterval: () => 0,
      clearInterval: () => {},
      http: {
        RequestMethod: { POST: 'POST', GET: 'GET' },
        HttpDataType: { STRING: 'STRING' },
        createHttp: () => ({
          destroy() {},
          request: async () => {
            state.checks += 1;
            await state.beforeResponse();
            return { responseCode: state.reachable ? 200 : 500, result: '{}' };
          },
        }),
      },
      logger: { info() {}, warn() {}, error() {} },
      deviceInfo: { osFullName: 'test-os' },
      setTimeout: (callback: () => void, delay: number) => {
        const id = ++nextTimer;
        const run = () => {
          if (!pendingTimers.delete(id)) return;
          callback();
        };
        pendingTimers.set(id, { callback: run, delay });
        timers.push(run);
        return id;
      },
      isSafePathComponent: (hash: string) => /^[a-zA-Z0-9_-]+$/.test(hash),
      getErrorMessage: (error: unknown) => String(error),
      NativePatchCore: {
        runnableConfig: (text: string) => {
          try {
            if (!text)
              return JSON.stringify(
                nativeUpdateResult('skipped', 'not_configured')
              );
            const c = JSON.parse(text);
            if (c.disabled)
              return JSON.stringify(nativeUpdateResult('skipped', 'disabled'));
            if (typeof c.appKey !== 'string' || !c.appKey.trim()) throw Error();
            return '';
          } catch {
            return JSON.stringify(
              nativeUpdateResult('failed', 'invalid_config')
            );
          }
        },
        hostCancellation: (
          host: string,
          round: string,
          stored: string,
          _a: number,
          _b: number,
          reset: number,
          current: number
        ) =>
          host !== round || host !== stored
            ? 'config_changed'
            : reset !== current
              ? 'reset'
              : '',
        stepRound: (previous: string, text: string) => {
          const e = JSON.parse(text);
          const s = previous ? JSON.parse(previous) : {};
          const finish = (
            status: string,
            reason = '',
            hash = '',
            activated = false
          ) => ({ type: 'finish', status, reason, hash, activated });
          let commands: object[];
          if (e.type === 'start') {
            s.reset = e.resetGeneration;
            s.config = e.configGeneration;
            commands = [{ type: 'markIncomplete' }, { type: 'collectEnv' }];
          } else if (e.type === 'cancel')
            commands = [finish('cancelled', e.reason)];
          else if (e.type === 'env')
            commands = [
              {
                type: 'http',
                url: 'https://test/check',
                post: true,
                body: '{}',
                timeoutMs: 10000,
                callTimeoutMs: 15000,
              },
            ];
          else if (e.type === 'http')
            commands = !e.text
              ? [finish('failed', 'check_failed')]
              : state.decision.action === 'download'
                ? [{ type: 'checkInstalled', hash: state.decision.hash }]
                : [];
          else if (e.type === 'installed' && !e.installed)
            commands = [
              {
                type: 'download',
                strategy: 'full',
                hash: state.decision.hash,
                url: 'https://test/full',
                deadline: 601000,
              },
            ];
          else if (e.type === 'committed')
            commands = [
              finish(
                e.ok ? (s.downloaded ? 'downloaded' : 'noUpdate') : 'cancelled',
                e.ok ? (s.downloaded ? '' : 'up_to_date') : 'reset',
                s.downloaded ? state.decision.hash : '',
                s.downloaded && !!state.decision.activate
              ),
            ];
          else commands = [];
          if (!commands.length) {
            s.downloaded =
              state.decision.action === 'download' && (e.installed || e.ok);
            if (state.decision.action === 'download' && !s.downloaded)
              commands = [finish('failed', 'download_failed')];
            else
              commands = [
                {
                  type: 'commit',
                  hash: s.downloaded ? state.decision.hash : '',
                  hashInfo: '',
                  activate: !!state.decision.activate,
                  cache: '{}',
                  resetGeneration: s.reset,
                  configGeneration: s.config,
                },
              ];
          }
          return JSON.stringify({ state: s, commands });
        },
        getSupportedDiffVersion: () => 2,
        buildCheckRequestBody: (input: string) => input,
        handleCheckResponse: (response: string) => response,
      },
      mockCheck: async () => {
        state.checks += 1;
        await state.beforeResponse();
        return state.reachable ? JSON.stringify(state.decision) : undefined;
      },
      mockDownload: async () => {
        state.downloads += 1;
        return state.downloadOK;
      },
    }
  ) as {
    check: (
      ctx: typeof context,
      timeoutMs?: number
    ) => Promise<NativeUpdateResult>;
    schedule: (ctx: typeof context, rollback: string) => void;
  };
  return {
    values,
    state,
    timers,
    check: (timeoutMs?: number) => runtime.check(context, timeoutMs),
    expire: (delay: number) => {
      const timer = [...pendingTimers.values()].find(
        (item) => item.delay === delay
      );
      if (!timer) throw new Error(`no pending timer for ${delay}ms`);
      timer.callback();
    },
    pending: (delay: number) =>
      [...pendingTimers.values()].filter((item) => item.delay === delay).length,
    initialize: () => runtime.schedule(context, 'rolled-back-version'),
  };
}

describe('native host API orchestration', () => {
  test('requires real launch initialization, without resolving the bundle', async () => {
    const h = harness();
    expect((await h.check()).reason).toBe('not_initialized');
    expect(h.state.checks).toBe(0);
    h.initialize();
    expect((await h.check()).status).toBe('noUpdate');
  });

  test('missing, disabled and malformed config do not consume a host round', async () => {
    const h = harness();
    h.initialize();
    h.values.delete('nativeConfig');
    expect((await h.check()).reason).toBe('not_configured');
    h.values.set('nativeConfig', '{');
    expect((await h.check()).reason).toBe('invalid_config');
    h.values.set('nativeConfig', JSON.stringify({ disabled: true }));
    expect((await h.check()).reason).toBe('disabled');
    expect(h.state.checks).toBe(0);
    h.values.set('nativeConfig', JSON.stringify({ appKey: 'test-app' }));
    expect((await h.check()).status).toBe('noUpdate');
    expect(h.state.checks).toBe(1);
  });

  test('manual, concurrent and delayed calls share one download and commit', async () => {
    const h = harness();
    h.initialize();
    h.state.decision = { action: 'download', hash: 'v2', activate: true };
    const first = h.check();
    const second = h.check();
    h.expire(5000);
    const results = await Promise.all([first, second]);
    expect(results[0]).toEqual(
      nativeUpdateResult('downloaded', '', 'v2', true)
    );
    expect(results[1]).toEqual(results[0]);
    results[0].hash = 'caller-mutated';
    expect((await h.check()).hash).toBe('v2');
    expect(h.state.checks).toBe(1);
    expect(h.state.downloads).toBe(1);
    expect(h.state.commits).toBe(1);
    expect(h.values.has('nativeCheckIncomplete')).toBe(false);
  });

  test('a download need not select a bundle for the next launch', async () => {
    const h = harness();
    h.initialize();
    h.state.decision = { action: 'download', hash: 'v2', activate: false };
    expect(await h.check()).toEqual(nativeUpdateResult('downloaded', '', 'v2'));
  });

  test('an installed version skips transfer but still reports activation', async () => {
    const h = harness();
    h.initialize();
    h.state.installed = true;
    h.state.decision = { action: 'download', hash: 'v2', activate: true };
    expect((await h.check()).activated).toBe(true);
    expect(h.state.downloads).toBe(0);
  });

  test('network and download failure are not reported as no update', async () => {
    const offline = harness();
    offline.initialize();
    offline.state.reachable = false;
    expect(await offline.check()).toEqual(
      nativeUpdateResult('failed', 'check_failed')
    );
    const h = harness();
    h.initialize();
    h.state.decision = { action: 'download', hash: 'v2' };
    h.state.downloadOK = false;
    expect(await h.check()).toEqual(
      nativeUpdateResult('failed', 'download_failed')
    );
    await h.check();
    expect(h.state.downloads).toBe(1);
  });

  test('reset during a round cancels its result', async () => {
    const h = harness();
    h.initialize();
    h.state.beforeResponse = async () => {
      h.state.generation += 1;
    };
    expect(await h.check()).toEqual(nativeUpdateResult('cancelled', 'reset'));
  });

  test('reset and configuration changes invalidate completed snapshots', async () => {
    const reset = harness();
    reset.initialize();
    await reset.check();
    reset.state.generation += 1;
    expect((await reset.check()).reason).toBe('reset');
    const h = harness();
    h.initialize();
    await h.check();
    h.values.set('nativeConfig', JSON.stringify({ appKey: 'other-app' }));
    expect((await h.check()).reason).toBe('config_changed');
    expect(h.state.checks).toBe(1);
  });

  test('a short caller times out independently while the shared round finishes for another', async () => {
    const h = harness();
    h.initialize();
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.state.beforeResponse = async () => {
      entered();
      await blocked;
    };
    h.state.decision = { action: 'download', hash: 'v2', activate: true };
    const patient = h.check(1000);
    await started;
    const impatient = h.check(5);
    h.expire(5);
    expect(await impatient).toEqual(nativeUpdateResult('failed', 'timeout'));
    expect(h.state.commits).toBe(0);
    expect(h.pending(5)).toBe(0);
    release();
    expect(await patient).toEqual(
      nativeUpdateResult('downloaded', '', 'v2', true)
    );
    expect(h.pending(1000)).toBe(0);
    expect((await h.check()).hash).toBe('v2');
    expect(h.state.checks).toBe(1);
    expect(h.state.downloads).toBe(1);
    expect(h.state.commits).toBe(1);
  });

  test('completed rounds clear a host timer before it can produce a second outcome', async () => {
    const h = harness();
    h.initialize();
    expect((await h.check(30)).status).toBe('noUpdate');
    expect(h.pending(30)).toBe(0);
    expect((await h.check(0)).status).toBe('noUpdate');
    expect(h.pending(0)).toBe(0);
    expect(h.state.checks).toBe(1);
  });

  for (const timeout of [undefined, Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    test(`host wait normalizes ${timeout} to a bounded timer`, async () => {
      const h = harness();
      h.initialize();
      let release!: () => void;
      let entered!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      h.state.beforeResponse = async () => {
        entered();
        await blocked;
      };
      const waiting = h.check(timeout);
      await started;
      h.expire(timeout === -1 ? 0 : 30 * 60 * 1000);
      expect((await waiting).reason).toBe('timeout');
      release();
      expect((await h.check()).status).toBe('noUpdate');
    });
  }

  for (const change of ['reset', 'config_changed'] as const) {
    test(`timed-out rounds cannot commit after ${change}`, async () => {
      const h = harness();
      h.initialize();
      let release!: () => void;
      let entered!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      h.state.beforeResponse = async () => {
        entered();
        await blocked;
      };
      h.state.decision = { action: 'download', hash: 'v2', activate: true };
      const waiting = h.check(5);
      await started;
      h.expire(5);
      expect((await waiting).reason).toBe('timeout');
      if (change === 'reset') h.state.generation += 1;
      else {
        h.state.configGeneration += 1;
        h.values.set('nativeConfig', JSON.stringify({ appKey: 'replacement' }));
      }
      release();
      expect((await h.check()).reason).toBe(change);
      expect(h.state.downloads).toBe(0);
      expect(h.state.commits).toBe(0);
      expect(h.values.has('nativeCheckIncomplete')).toBe(false);
    });
  }
});

test('automatic preflight without configuration leaves a round for later native provisioning', async () => {
  const h = harness();
  h.values.delete('nativeConfig');
  h.initialize();
  for (const timer of h.timers) timer();
  await Promise.resolve();
  expect(h.state.checks).toBe(0);
  h.values.set(
    'nativeConfig',
    JSON.stringify({
      appKey: 'native-first-app',
      afterDownload: 'setNeedUpdate',
    })
  );
  h.state.decision = { action: 'download', hash: 'v2', activate: true };
  expect((await h.check()).activated).toBe(true);
  expect(h.state.checks).toBe(1);
});

test('configuration replacement during an update cancels its returned snapshot', async () => {
  const h = harness();
  h.initialize();
  h.state.decision = { action: 'download', hash: 'v2', activate: true };
  h.state.beforeResponse = async () => {
    h.values.set('nativeConfig', JSON.stringify({ appKey: 'replacement' }));
    h.state.generation += 1;
  };
  expect(await h.check()).toEqual(
    nativeUpdateResult('cancelled', 'config_changed')
  );
});
