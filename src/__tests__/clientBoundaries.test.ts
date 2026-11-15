/**
 * [INPUT]: 依赖 Bun 测试、真实客户端与受控 React Native/网络替身，隔离单例模块状态
 * [OUTPUT]: 对外提供渠道/请求体、缓存/根响应、slot 身份、方法替换与上报边界回归
 * [POS]: src 的客户端兼容边界测试，约束公开调用行为，不承担真实原生平台执行
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { CheckResult } from '../type';

const originalDev = (globalThis as any).__DEV__;
afterEach(() => {
  (globalThis as any).__DEV__ = originalDev;
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const setup = async (key: string, os = 'ios') => {
  (globalThis as any).__DEV__ = false;
  const native = {
    markSuccess: mock(async (_hash: string) => true),
    reloadUpdate: mock(async () => {}),
    setNeedUpdate: mock(async () => {}),
    restartApp: mock(async () => {}),
    resetToPackagedBundle: mock(async () => {}),
    downloadFullUpdate: mock(async () => {}),
    syncNativeConfig: mock(async (_json: string) => {}),
  };
  const cInfo = { rnu: '1.0.0', rn: '0.73.0', uuid: 'device', os };
  mock.module('react-native', () => ({
    Platform: { OS: os },
    DeviceEventEmitter: { addListener: () => ({ remove() {} }) },
  }));
  mock.module('../core', () => ({
    PaktaModule: native,
    buildTime: 'opaque-build',
    channel: 'huawei',
    cInfo,
    currentVersion: 'running-hash',
    currentVersionInfo: {},
    getBundleHash: () => 'bundle-sha',
    isFirstTime: true,
    isRolledBack: false,
    packageVersion: '1.0.0',
    rolledBackVersion: '',
    supportedDiffVersion: 2,
    setLocalHashInfo: mock(async () => {}),
    paktaNativeEventEmitter: { addListener: () => ({ remove() {} }) },
  }));
  mock.module('../i18n', () => ({
    default: { t: (key: string) => key, setLocale: () => {} },
  }));
  const module = await import(`../client?boundaries-${key}`);
  const client = new module.Pakta({
    appKey: 'app',
    logger: () => {},
    disableTelemetry: true,
    maxRetries: 0,
    server: { main: ['https://main.example'], queryUrls: [] },
  });
  return { ...module, client, native, cInfo };
};

describe('M1 客户端职责边界特征', () => {
  for (const os of ['ios', 'android', 'harmony']) {
    test(`${os} 请求保持原生 channel 与平台 body 形状`, async () => {
      const { client, native } = await setup(`channel-${os}`, os);
      const fetchResult = mock(async (_payload: RequestInit) => ({
        upToDate: true,
      }));
      client.fetchCheckResult = fetchResult;
      await client.checkUpdate({ channel: 'spoofed', custom: 'retained' });
      const payload = fetchResult.mock.calls[0][0];
      const body =
        os === 'harmony' ? payload.body : JSON.parse(String(payload.body));
      expect(typeof payload.body).toBe(os === 'harmony' ? 'object' : 'string');
      expect(body).toMatchObject({
        channel: 'huawei',
        buildTime: 'opaque-build',
        custom: 'retained',
      });
      expect(JSON.parse(native.syncNativeConfig.mock.calls[0][0]).channel).toBe(
        'huawei'
      );
    });
  }

  test('公开缓存字段可写且保留根响应，缓存命中重新执行设备归一化', async () => {
    const { client } = await setup('root-cache');
    const root = {
      update: true,
      hash: 'root',
      full: 'root.ppk',
      paths: ['https://cdn.example'],
      expVersion: {
        hash: 'gray',
        full: 'gray.ppk',
        name: 'gray',
        description: '',
        metaInfo: '',
        config: { rollout: { '1.0.0': 100 } },
      },
    };
    const fetchResult = mock(async () => root);
    client.fetchCheckResult = fetchResult;
    expect(await client.checkUpdate()).toMatchObject({ hash: 'gray' });
    expect(await client.lastRespJson).toBe(root);
    root.expVersion.config.rollout['1.0.0'] = 0;
    expect(await client.checkUpdate()).toMatchObject({ hash: 'root' });
    expect(await client.lastRespJson).toBe(root);
    client.lastRespJson = Promise.resolve({ upToDate: true });
    expect(await client.checkUpdate()).toEqual({ upToDate: true });
    expect(fetchResult).toHaveBeenCalledTimes(1);
    client.lastChecking = 0;
    await client.checkUpdate();
    expect(fetchResult).toHaveBeenCalledTimes(2);
    client.lastCheckFingerprint = 'replaced';
    await client.checkUpdate();
    expect(fetchResult).toHaveBeenCalledTimes(3);
    expect(root.expVersion.hash).toBe('gray');
  });

  test('旧检查失败不清除新检查缓存槽，替换通知与错误方法仍生效', async () => {
    const { client } = await setup('slot');
    const old = deferred<CheckResult>();
    const latest = deferred<CheckResult>();
    const fetchResult = mock((payload: RequestInit) =>
      JSON.parse(String(payload.body)).round === 'old'
        ? old.promise
        : latest.promise
    );
    client.fetchCheckResult = fetchResult;
    client.notifyAfterCheckUpdate = mock(() => {});
    client.throwIfEnabled = mock(() => {});
    const first = client.checkUpdate({ round: 'old' });
    const second = client.checkUpdate({ round: 'new' });
    const slot = client.lastRespJson;
    latest.resolve({ upToDate: true });
    await second;
    old.reject(Error('old failure'));
    await first;
    expect(client.lastRespJson).toBe(slot);
    await client.checkUpdate({ round: 'new' });
    expect(fetchResult).toHaveBeenCalledTimes(2);
    expect(client.notifyAfterCheckUpdate).toHaveBeenCalledTimes(3);
    expect(client.throwIfEnabled).toHaveBeenCalledTimes(1);
  });

  test('检查调用实例端点和请求方法而非内部绑定副本', async () => {
    const { client } = await setup('methods');
    client.getCheckUrl = mock(() => 'https://replacement.example/check');
    const fetchMock = mock(async () => ({
      ok: true,
      json: async () => ({ upToDate: true }),
    }));
    globalThis.fetch = fetchMock as any;
    await client.requestCheckResult('https://ignored.example', {});
    expect((fetchMock.mock.calls[0] as any[])[0]).toBe(
      'https://replacement.example/check'
    );
    client.getConfiguredCheckEndpoints = mock(() => [
      'https://replacement.example',
    ]);
    client.getRemoteEndpoints = mock(async () => []);
    client.requestCheckResult = mock(async () => ({ upToDate: true }));
    await client.checkUpdate();
    expect(client.getConfiguredCheckEndpoints).toHaveBeenCalled();
    expect(client.requestCheckResult).toHaveBeenCalledTimes(1);
  });

  test('下载等待替换后的 report，激活与重置调用实例钩子和重启方法', async () => {
    const { client, sharedState, native } = await setup('download-activation');
    const report = deferred<void>();
    client.report = mock((event: { type: string }) =>
      event.type === 'downloadSuccess' ? report.promise : Promise.resolve()
    );
    globalThis.fetch = mock(async () => ({
      ok: true,
      url: 'https://cdn.example/full.ppk',
    })) as any;
    let settled = false;
    const task = client
      .downloadUpdate({
        update: true,
        hash: 'next',
        full: 'full.ppk',
        paths: ['https://cdn.example'],
      })
      .then((hash: string) => {
        settled = true;
        return hash;
      });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    expect(sharedState.downloadedHash).toBeUndefined();
    report.resolve();
    expect(await task).toBe('next');
    client.assertDebug = mock(() => true);
    client.runBeforeReload = mock(async () => false);
    expect(await client.switchVersion('next')).toBe(false);
    expect(native.reloadUpdate).not.toHaveBeenCalled();
    client.restartApp = mock(async () => {});
    expect(await client.resetToPackagedBundle({ restart: true })).toBe(true);
    expect(client.restartApp).toHaveBeenCalledTimes(1);
    await client.markSuccess();
    expect(native.markSuccess).toHaveBeenCalledWith('running-hash');
  });

  test('loggerPromise 可替换，异常报告读取实例有效包版本', async () => {
    const { client } = await setup('logger');
    const logger = deferred<void>();
    client.loggerPromise = { promise: logger.promise, resolve: logger.resolve };
    const listener = mock(() => {});
    client.setOptions({ logger: listener });
    await client.loggerPromise.promise;
    client.getEffectivePackageVersion = () => 'overridden';
    client.setOptions({
      disableTelemetry: false,
      disableErrorReporting: false,
    });
    const fetchMock = mock(async () => ({}));
    globalThis.fetch = fetchMock as any;
    client.captureException(Error('captured'));
    expect(
      JSON.parse(String((fetchMock.mock.calls[0] as any[])[1].body))
        .packageVersion
    ).toBe('overridden');
    await client.report({ type: 'checking' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('查询参数模块隔离单例与所有共享状态容器', async () => {
    const first = await setup('isolation-a');
    first.sharedState.downloadedHash = 'only-a';
    first.sharedState.marked = true;
    const specifier = '../client?boundaries-isolation-b';
    const second = await import(specifier);
    const client = new second.Pakta({
      appKey: 'different-app',
      disableTelemetry: true,
    });
    expect(client).not.toBe(first.client);
    expect(second.sharedState).not.toBe(first.sharedState);
    expect(second.sharedState.progressHandlers).not.toBe(
      first.sharedState.progressHandlers
    );
    expect(second.sharedState.downloadingTasks).not.toBe(
      first.sharedState.downloadingTasks
    );
    expect(second.sharedState.progressCallbacks).not.toBe(
      first.sharedState.progressCallbacks
    );
    expect(second.sharedState.downloadedHash).toBeUndefined();
    expect(second.sharedState.marked).toBe(false);
  });
});
