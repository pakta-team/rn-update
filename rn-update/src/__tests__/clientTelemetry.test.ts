/**
 * [INPUT]: 依赖 client 的公开 report 边界、telemetry 的事件归类规则，以及 Bun mock 隔离的 core/utils 原生与网络适配
 * [OUTPUT]: 提供下载降级与激活前回执等待回归，证明网络噪声不污染 patch_fail、真实补丁失败只上报一次且重启不会截断 download_success
 * [POS]: __tests__ 的客户端遥测契约测试，跨越本地事件到服务端请求体的最小集成边界，补充 telemetry 纯函数单测
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { afterEach, describe, expect, mock, test } from 'bun:test';

const originalDev = (globalThis as any).__DEV__;

afterEach(() => {
  (globalThis as any).__DEV__ = originalDev;
});

const createTelemetryClient = async (
  cacheKey: string,
  fallbackKind: 'network' | 'patch'
) => {
  (globalThis as any).__DEV__ = false;
  const fetchWithTimeout = mock(() => Promise.resolve({} as Response));
  const fallbackError = Error(
    fallbackKind === 'patch'
      ? 'patch checksum mismatch'
      : 'diff request timed out'
  ) as Error & { code?: string };
  if (fallbackKind === 'patch') {
    fallbackError.code = 'PATCH_FAILED';
  }
  const downloadPatchFromPpk = mock(() => Promise.reject(fallbackError));
  const downloadPatchFromPackage = mock(() => Promise.resolve());

  mock.module('../core', () => ({
    PaktaModule: {
      downloadFullUpdate: mock(() => Promise.resolve()),
      downloadPatchFromPackage,
      downloadPatchFromPpk,
    },
    buildTime: 'build-token',
    channel: 'huawei',
    cInfo: {
      rnu: '1.0.0',
      rn: '0.73.0',
      os: 'ios',
      uuid: 'device-id',
    },
    currentVersion: 'current-hash',
    currentVersionInfo: {},
    getBundleHash: () => '',
    isFirstTime: false,
    isRolledBack: false,
    packageVersion: '1.0.0',
    paktaNativeEventEmitter: {
      addListener: mock(() => ({ remove: mock(() => {}) })),
    },
    rolledBackVersion: '',
    setLocalHashInfo: mock(() => {}),
    supportedDiffVersion: 2,
  }));
  mock.module('../i18n', () => ({
    default: {
      setLocale: mock(() => {}),
      t: (key: string) => key,
    },
  }));
  mock.module('../permissions', () => ({
    PermissionsAndroid: {
      PERMISSIONS: {},
      RESULTS: {},
      request: mock(() => Promise.resolve('granted')),
    },
  }));
  mock.module('../utils', () => ({
    DEFAULT_FETCH_TIMEOUT_MS: 5000,
    assertWeb: () => {},
    computeProgress: () => 0,
    fetchWithTimeout,
    info: mock(() => {}),
    log: mock(() => {}),
    noop: () => {},
    promiseAny: mock(() => Promise.resolve(undefined)),
    testUrls: async (urls?: string[]) => urls?.[0] ?? null,
    warn: mock(() => {}),
  }));

  const { Pakta, sharedState } = await import(`../client?${cacheKey}`);
  sharedState.downloadedHash = undefined;
  const client = new Pakta({
    appKey: 'demo-app',
    logger: mock(() => {}),
    maxRetries: 0,
    server: { main: ['https://updates.example.com/api'] },
  });
  return { client, fetchWithTimeout };
};

const updateInfo = {
  update: true as const,
  hash: 'next-hash',
  diff: 'diff.ppk',
  pdiff: 'pdiff.ppk',
  paths: ['https://cdn.example.com'],
};

const reportedTypes = (fetchWithTimeout: ReturnType<typeof mock>) =>
  (
    fetchWithTimeout.mock.calls as unknown as Array<
      [string, RequestInit, number]
    >
  ).map(([, options]) => {
    return JSON.parse(String(options.body)).type as string;
  });

const reportedPayloads = (fetchWithTimeout: ReturnType<typeof mock>) =>
  (
    fetchWithTimeout.mock.calls as unknown as Array<
      [string, RequestInit, number]
    >
  ).map(
    ([, options]) => JSON.parse(String(options.body)) as Record<string, unknown>
  );

describe('client download fallback telemetry', () => {
  test('下载成功在调用方继续切换前等待服务端回执', async () => {
    const { client, fetchWithTimeout } = await createTelemetryClient(
      'telemetry-flush-before-switch',
      'network'
    );
    let resolveReport: (() => void) | undefined;
    fetchWithTimeout.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveReport = () => resolve({} as Response);
        })
    );

    let settled = false;
    const task = client.downloadUpdate(updateInfo).then((hash: string) => {
      settled = true;
      return hash;
    });
    // 等待增量回退链抵达成功上报；中间 Promise 轮数属于实现细节。
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(settled).toBe(false);
    expect(resolveReport).toBeDefined();
    resolveReport?.();
    expect(await task).toBe('next-hash');
    expect(reportedTypes(fetchWithTimeout)).toEqual(['download_success']);
  });

  test('普通网络降级只上报下载成功，不误报 patch_fail', async () => {
    const { client, fetchWithTimeout } = await createTelemetryClient(
      'telemetry-network-fallback',
      'network'
    );

    await client.downloadUpdate(updateInfo);

    expect(reportedTypes(fetchWithTimeout)).toEqual(['download_success']);
    expect(reportedPayloads(fetchWithTimeout)[0]).toMatchObject({
      channel: 'huawei',
      buildTime: 'build-token',
    });
  });

  test('真实补丁降级只上报一次 patch_fail', async () => {
    const { client, fetchWithTimeout } = await createTelemetryClient(
      'telemetry-patch-fallback',
      'patch'
    );

    await client.downloadUpdate(updateInfo);

    expect(reportedTypes(fetchWithTimeout)).toEqual([
      'patch_fail',
      'download_success',
    ]);
  });
});
