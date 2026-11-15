/**
 * [INPUT]: 依赖 bun:test、VM 与真实配置共享核，准备钩子先编译宿主，再隔离运行 Harmony 适配器和 UpdateContext
 * [OUTPUT]: 提供 normalizeNativeUpdateConfig 与 setNativeConfig 落库/代际失效/重复幂等的无桥配置回归断言
 * [POS]: __tests__ 的无桥配置套件，锁定三端镜像归一化器与 JS 侧配置持久化之间的契约
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { configCore, normalizeConfiguration } from './nativeConfigHost';

beforeAll(() => {
  configCore('normalize', ['{"appKey":"fixture"}']);
}, 30000);

type NativeUpdateConfig = Record<string, unknown>;

function runtimeSource(relativePath: string): string {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?;\r?\n/gm, '')
    .replace(/^export\s*(?:type\s*)?\{[^}]*\}(?:\s*from\s*[^;]*)?;\r?\n/gm, '')
    .replace(/^export /gm, '');
  return new Bun.Transpiler({ loader: 'ts' }).transformSync(source);
}

const storeSource = runtimeSource(
  '../../harmony/pakta/src/main/ets/UpdateContext.ts'
);
const normalizeNativeUpdateConfig = runInNewContext(
  `${runtimeSource('../../harmony/pakta/src/main/ets/NativeUpdateConfig.ts')}\nnormalizeNativeUpdateConfig`,
  { NativePatchCore: { normalizeConfiguration } }
) as (options: NativeUpdateConfig) => string;
const clientSource = [
  '../clientState.ts',
  '../clientReporter.ts',
  '../clientNativeConfig.ts',
  '../clientCheck.ts',
  '../clientDownload.ts',
  '../clientActivation.ts',
  '../client.ts',
]
  .map(runtimeSource)
  .join('\n');

interface ConfigStore {
  setNativeConfig: (config: string) => Promise<void>;
  getResetGeneration: () => number;
  commitNativeCheckResult: (
    generation: number,
    hash: string,
    info: string,
    activate: boolean,
    cache: string
  ) => Promise<boolean>;
}

function storeHarness() {
  const values = new Map<string, string>();
  let flushes = 0;
  let shouldFail = false;
  const clearedSignals: string[] = [];
  const preferences = {
    getSync: (key: string, fallback: string) => values.get(key) ?? fallback,
    putSync: (key: string, value: string) => values.set(key, value),
    deleteSync: (key: string) => values.delete(key),
    flush: async () => {
      flushes++;
      if (shouldFail) throw new Error('storage unavailable');
    },
  };
  const store = runInNewContext(
    `${storeSource}\nconst store = Object.create(UpdateContext.prototype); store.taskChain = Promise.resolve(); store.preferences = preferences; store.flushBatchDepth = 0; store;`,
    {
      preferences,
      util: { generateRandomUUID: () => 'native-installation-id' },
      KEY_CONFIG: 'nativeConfig',
      KEY_RESP_CACHE: 'nativeCheckResp',
      markJsCheckCompleted: (config: string) => clearedSignals.push(config),
      logger: { error() {} },
      getErrorMessage: (error: unknown) => String(error),
    }
  ) as ConfigStore;
  return {
    store,
    values,
    clearedSignals,
    fail: (value: boolean) => {
      shouldFail = value;
    },
    flushes: () => flushes,
  };
}

function clientHarness(native: boolean) {
  const writes: string[] = [];
  const client = runInNewContext(
    `${clientSource}\nnew Pakta({appKey: 'test-app', nativeConfigSource: source, disableTelemetry: true});`,
    {
      source: native ? 'native' : 'javascript',
      __DEV__: false,
      assertWeb() {},
      noop() {},
      log() {},
      setDebugLogging() {},
      // 本地 pakta 扩展：上游无 channel，合并后的 client 会引用它。
      channel: '',
      cInfo: { rnu: 'test-sdk', rn: 'test-rn' },
      packageVersion: '1.0',
      isRolledBack: false,
      Platform: { OS: 'android' },
      i18n: { setLocale() {} },
      dedupeEndpoints: (urls: string[]) => [...new Set(urls)],
      PaktaModule: {
        syncNativeConfig: async (config: string) => {
          writes.push(config);
        },
      },
    }
  ) as { setOptions: (options: Record<string, unknown>) => void };
  return { client, writes };
}

describe('native configuration normalization', () => {
  test('appKey alone supplies Pakta endpoints without automatically activating', () => {
    const config = JSON.parse(
      normalizeNativeUpdateConfig({ appKey: 'test-app' })
    );
    expect(config.endpoints).toEqual(['https://pakta.yoghourt.space/api']);
    expect(config.queryUrls).toHaveLength(1);
    expect(config.afterDownload).toBe('none');
    expect(config.disabled).toBe(false);
    expect(config.packageVersion).toBeUndefined();
    expect(Object.keys(config).sort()).toEqual([
      'afterDownload',
      'appKey',
      'disabled',
      'endpoints',
      'queryUrls',
      'rn',
      'rnu',
    ]);
  });

  test('custom endpoints do not inherit public discovery, and are deduplicated', () => {
    const options: NativeUpdateConfig = {
      appKey: 'test-app',
      endpoints: [
        'https://updates.example/api/',
        'https://updates.example/api',
      ],
      afterDownload: 'setNeedUpdate',
    };
    const original = JSON.stringify(options);
    const config = JSON.parse(normalizeNativeUpdateConfig(options));
    expect(config.endpoints).toEqual(['https://updates.example/api']);
    expect(config.queryUrls).toEqual([]);
    expect(config.afterDownload).toBe('setNeedUpdate');
    expect(JSON.stringify(options)).toBe(original);
  });

  test('allows explicit discovery URLs and version identity overrides', () => {
    const config = JSON.parse(
      normalizeNativeUpdateConfig({
        appKey: 'test-app',
        endpoints: ['http://localhost:8080/api'],
        queryUrls: ['https://updates.example/endpoints.json?v=1'],
        packageVersion: '2.0',
        rn: '0.77.3',
        rnu: 'test-sdk',
        disabled: true,
      })
    );
    expect(config.packageVersion).toBe('2.0');
    expect(config.disabled).toBe(true);
    expect(config.queryUrls[0]).toContain('?v=1');
  });

  for (const [name, options] of [
    ['missing key', {}],
    ['blank key', { appKey: '   ' }],
    ['wrong key type', { appKey: 12 }],
    ['empty endpoints', { appKey: 'a', endpoints: [] }],
    ['null endpoints', { appKey: 'a', endpoints: null }],
    ['non-array endpoints', { appKey: 'a', endpoints: 'https://example.com' }],
    ['unsafe scheme', { appKey: 'a', endpoints: ['file:///tmp/update'] }],
    [
      'credentials',
      { appKey: 'a', endpoints: ['https://user:pass@example.com'] },
    ],
    ['relative URL', { appKey: 'a', endpoints: ['/api'] }],
    ['base query', { appKey: 'a', endpoints: ['https://example.com/api?x=1'] }],
    ['wrong discovery type', { appKey: 'a', queryUrls: [42] }],
    ['wrong activation', { appKey: 'a', afterDownload: 'immediate' }],
    ['wrong disabled type', { appKey: 'a', disabled: 'false' }],
    ['blank package version', { appKey: 'a', packageVersion: '' }],
    ['unknown option', { appKey: 'a', endponts: ['https://example.com'] }],
    ['fixed host channel', { appKey: 'a', channel: 'other' }],
    ['null channel', { appKey: 'a', channel: null }],
    ['undefined channel', { appKey: 'a', channel: undefined }],
  ] as const) {
    test(`rejects ${name} before storage is touched`, () => {
      expect(() =>
        normalizeNativeUpdateConfig(options as unknown as NativeUpdateConfig)
      ).toThrow();
    });
  }
});

describe('shared configuration features', () => {
  test('internal channel stays available but fixed-host mode rejects even default and null', () => {
    for (const channel of ['default', 'other', null]) {
      const input = JSON.stringify({ appKey: 'a', channel });
      expect(configCore('normalize', [input])).toEqual({
        error: 'Invalid native configuration: unknown option channel',
      });
    }
    const internal = configCore('normalize', [
      '{"appKey":"a","channel":"internal"}',
      true,
    ]) as { value: string };
    expect(JSON.parse(internal.value).channel).toBe('internal');
  });

  test('JS whitespace, gate truthiness and malformed persisted JSON use shared semantics', () => {
    expect(configCore('normalize', ['{"appKey":"\\u00a0\\ufeff"}'])).toEqual({
      error:
        'Invalid native configuration: appKey must be a string and must not be blank',
    });
    for (const [json, expected] of [
      ['', { status: 'skipped', reason: 'not_configured' }],
      ['[]', { status: 'failed', reason: 'invalid_config' }],
      ['{"appKey":" "}', { status: 'failed', reason: 'invalid_config' }],
      [
        '{"appKey":"a","disabled":"false"}',
        { status: 'skipped', reason: 'disabled' },
      ],
      ['{"appKey":" a "}', { appKey: 'a' }],
    ] as const)
      expect(JSON.parse(configCore('gate', [json]) as string)).toEqual(
        expected
      );
  });

  test('equivalence ignores defaults/key order/slashes but not identities; A-B-A cancels', () => {
    const a = '{"appKey":"a","endpoints":["https://a/"]}';
    const b =
      '{"endpoints":["https://a","https://a/"],"appKey":"a","disabled":false,"channel":"default"}';
    expect(configCore('equivalent', [a, b])).toBe(true);
    expect(configCore('equivalent', ['', ''])).toBe(false);
    expect(configCore('cancel', [a, b, a, 1, 1, 2, 2])).toBe('');
    expect(configCore('cancel', [a, b, a, 1, 3, 2, 4])).toBe('config_changed');
    expect(configCore('cancel', [a, b, a, 1, 1, 2, 4])).toBe('reset');
  });
});

describe('actual native configuration store', () => {
  test('configuration invalidates cache and old in-flight commits, even across A-B-A', async () => {
    const h = storeHarness();
    await h.store.setNativeConfig('A');
    const oldGeneration = h.store.getResetGeneration();
    h.values.set('nativeCheckResp', 'stale');
    await h.store.setNativeConfig('B');
    expect(h.values.has('nativeCheckResp')).toBe(false);
    await h.store.setNativeConfig('A');
    expect(h.store.getResetGeneration()).toBe(oldGeneration + 2);
    expect(
      await h.store.commitNativeCheckResult(
        oldGeneration,
        'old',
        '{}',
        true,
        'stale'
      )
    ).toBe(false);
    expect(h.values.has('hash_old')).toBe(false);
    expect(h.values.get('uuid')).toBe('native-installation-id');
    expect(h.clearedSignals).toEqual(['', '', '']);
  });

  test('identical configuration is idempotent but still confirms persistence', async () => {
    const h = storeHarness();
    await h.store.setNativeConfig('A');
    const generation = h.store.getResetGeneration();
    await h.store.setNativeConfig('A');
    expect(h.store.getResetGeneration()).toBe(generation);
    expect(h.flushes()).toBe(2);
  });

  test('storage errors reject and an equal-value retry can recover', async () => {
    const h = storeHarness();
    h.fail(true);
    await expect(h.store.setNativeConfig('A')).rejects.toThrow(
      'storage unavailable'
    );
    h.fail(false);
    await h.store.setNativeConfig('A');
    expect(h.flushes()).toBe(2);
  });
});

describe('JS native configuration ownership', () => {
  test('native ownership suppresses constructor and setOptions writes', () => {
    const h = clientHarness(true);
    expect(h.writes).toEqual([]);
    h.client.setOptions({ updateStrategy: 'silentAndLater' });
    expect(h.writes).toEqual([]);
  });

  test('JS ownership retains existing synchronization, with explicit handover', () => {
    const js = clientHarness(false);
    expect(js.writes).toHaveLength(1);
    const native = clientHarness(true);
    native.client.setOptions({ nativeConfigSource: 'javascript' });
    expect(native.writes).toHaveLength(1);
  });
});
