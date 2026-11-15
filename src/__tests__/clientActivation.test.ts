/**
 * [INPUT]: 依赖 Bun 测试替身、真实 client 门面和职责模块，以可控原生回执驱动确认与重置竞态
 * [OUTPUT]: 提供 M1/T07 单飞、启动 hash 门卫、失败重试与重置晚结果隔离的专项回归
 * [POS]: __tests__ 的激活生命周期合约；通过查询参数隔离进程状态，不替换被测激活实现
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { afterEach, describe, expect, mock, test } from 'bun:test';

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

const setup = async (key: string, isFirstTime = true) => {
  (globalThis as any).__DEV__ = false;
  const native = {
    markSuccess: mock(
      (_hash: string): Promise<boolean> => Promise.resolve(true)
    ),
    resetToPackagedBundle: mock((): Promise<void> => Promise.resolve()),
  };
  mock.module('../core', () => ({
    PaktaModule: native,
    buildTime: 'opaque-build',
    channel: 'huawei',
    cInfo: { rnu: '1.0.0', rn: '0.73.0', uuid: 'device', os: 'ios' },
    currentVersion: 'running-hash',
    currentVersionInfo: { forceBootRescue: true, crashRescue: true },
    getBundleHash: () => 'bundle-sha',
    isFirstTime,
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
  const module = await import(`../client?activation-${key}`);
  const client = new module.Pakta({ appKey: 'app', disableTelemetry: true });
  client.report = mock(async (_event: { type: string }) => {});
  const errors = mock(() => {});
  client.onError(errors);
  return { ...module, client, native, errors };
};

describe('M1/T07 成功确认单飞与重置隔离', () => {
  test('并发共享同一任务，仅确认启动 hash 并各上报一次成功与救援', async () => {
    const { client, native, sharedState } = await setup('concurrent');
    const gate = deferred<boolean>();
    native.markSuccess.mockImplementation(() => gate.promise);
    sharedState.downloadedHash = 'downloaded-not-running';
    const first = client.markSuccess();
    const second = client.markSuccess();
    expect(native.markSuccess).toHaveBeenCalledTimes(1);
    expect(native.markSuccess).toHaveBeenCalledWith('running-hash');
    expect(second).toBe(first);
    expect(sharedState.marked).toBe(false);
    expect(client.report).not.toHaveBeenCalled();
    gate.resolve(true);
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(sharedState.marked).toBe(true);
    expect(client.report).toHaveBeenCalledTimes(3);
    for (const type of ['markSuccess', 'forceBootRescue', 'crashRescue']) {
      expect(client.report).toHaveBeenCalledWith({ type });
    }
    expect(await client.markSuccess()).toBeUndefined();
    expect(native.markSuccess).toHaveBeenCalledTimes(1);
  });

  test('进入原生前发布任务，同步重入复用同一任务', async () => {
    const { client, native } = await setup('reentrant');
    let nested: ReturnType<typeof client.markSuccess> | undefined;
    let entered = false;
    native.markSuccess.mockImplementation(() => {
      if (!entered) {
        entered = true;
        nested = client.markSuccess();
      }
      return Promise.resolve(true);
    });
    const first = client.markSuccess();
    expect(nested).toBe(first);
    expect(await first).toBe(true);
    expect(native.markSuccess).toHaveBeenCalledTimes(1);
  });

  test('原生拒绝由并发调用共享 false，下一轮可重试', async () => {
    const { client, native, sharedState, errors } = await setup('declined');
    const gate = deferred<boolean>();
    native.markSuccess.mockImplementationOnce(() => gate.promise);
    const first = client.markSuccess();
    const second = client.markSuccess();
    gate.resolve(false);
    expect(await Promise.all([first, second])).toEqual([false, false]);
    expect(sharedState.marked).toBe(false);
    expect(client.report).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    expect(await client.markSuccess()).toBe(true);
    expect(native.markSuccess).toHaveBeenCalledTimes(2);
  });

  for (const synchronous of [false, true]) {
    test(`${synchronous ? '同步抛错' : '异步拒绝'}共享归一化错误且失败后可重试`, async () => {
      const { client, native, sharedState, errors } = await setup(
        `failure-${synchronous}`
      );
      const gate = deferred<boolean>();
      native.markSuccess.mockImplementationOnce(() => {
        if (synchronous) {
          throw Error('native failed');
        }
        return gate.promise;
      });
      const first = client.markSuccess();
      const second = client.markSuccess();
      const results = Promise.allSettled([first, second]);
      if (!synchronous) {
        gate.reject(Error('native failed'));
      }
      const settled = await results;
      expect(settled[0]).toMatchObject({
        status: 'rejected',
        reason: { code: 'MARK_SUCCESS_FAILED' },
      });
      expect(settled[1]).toEqual(settled[0]);
      expect(sharedState.marked).toBe(false);
      expect(errors).toHaveBeenCalledTimes(1);
      expect(await client.markSuccess()).toBe(true);
      expect(native.markSuccess).toHaveBeenCalledTimes(2);
    });
  }

  for (const outcome of ['accepted', 'declined', 'rejected'] as const) {
    test(`reset 后旧 ${outcome} 不置位、不上报、不清除新任务`, async () => {
      const { client, native, sharedState, errors } = await setup(
        `reset-${outcome}`
      );
      const old = deferred<boolean>();
      const next = deferred<boolean>();
      native.markSuccess
        .mockImplementationOnce(() => old.promise)
        .mockImplementationOnce(() => next.promise);
      const first = client.markSuccess();
      const oldResult = Promise.allSettled([first]);
      expect(await client.resetToPackagedBundle()).toBe(true);
      const second = client.markSuccess();
      if (outcome === 'rejected') {
        old.reject(Error('stale failure'));
      } else {
        old.resolve(outcome === 'accepted');
      }
      expect(await oldResult).toEqual([{ status: 'fulfilled', value: false }]);
      expect(sharedState.marked).toBe(false);
      expect(errors).not.toHaveBeenCalled();
      expect(client.report).toHaveBeenCalledTimes(1);
      expect(client.report).toHaveBeenCalledWith({ type: 'reset' });
      const third = client.markSuccess();
      expect(third).toBe(second);
      expect(native.markSuccess).toHaveBeenCalledTimes(2);
      next.resolve(true);
      expect(await Promise.all([second, third])).toEqual([true, true]);
      expect(sharedState.marked).toBe(true);
      expect(client.report).toHaveBeenCalledTimes(4);
    });
  }

  test('reset 失败保留原确认任务与结果所有权', async () => {
    const { client, native, sharedState } = await setup('reset-failure');
    const gate = deferred<boolean>();
    native.markSuccess.mockImplementation(() => gate.promise);
    native.resetToPackagedBundle.mockImplementationOnce(() =>
      Promise.reject(Error('reset failed'))
    );
    const first = client.markSuccess();
    expect(await client.resetToPackagedBundle()).toBe(false);
    expect(client.markSuccess()).toBe(first);
    gate.resolve(true);
    expect(await first).toBe(true);
    expect(sharedState.marked).toBe(true);
    expect(native.markSuccess).toHaveBeenCalledTimes(1);
  });

  test('reset 尚未完成时保留单飞，成功后隔离晚回执', async () => {
    const { client, native, sharedState } = await setup('reset-pending');
    const mark = deferred<boolean>();
    const reset = deferred<void>();
    native.markSuccess.mockImplementation(() => mark.promise);
    native.resetToPackagedBundle.mockImplementation(() => reset.promise);
    const first = client.markSuccess();
    const resetting = client.resetToPackagedBundle();
    expect(client.markSuccess()).toBe(first);
    reset.resolve();
    expect(await resetting).toBe(true);
    mark.resolve(true);
    expect(await first).toBe(false);
    expect(sharedState.marked).toBe(false);
    expect(client.report).toHaveBeenCalledTimes(1);
  });

  test('非首次启动和开发态不进入原生确认', async () => {
    const first = await setup('not-first', false);
    expect(await first.client.markSuccess()).toBeUndefined();
    expect(first.native.markSuccess).not.toHaveBeenCalled();
    const dev = await setup('development');
    (globalThis as any).__DEV__ = true;
    expect(await dev.client.markSuccess()).toBeUndefined();
    expect(dev.native.markSuccess).not.toHaveBeenCalled();
  });
});
