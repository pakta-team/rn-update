/**
 * [INPUT]: 依赖 Bun/VM 现提三端旧布局选择性清理逻辑与 Harmony UpdateContext，提供受限平台替身
 * [OUTPUT]: 对外提供安装级数据保护、单 flush、代际拒绝与运行目录保护回归
 * [POS]: src 的版本级清理契约宿主，验证删除边界而不证明真实平台存储或迁移
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

const android = read(
  'android/src/main/java/cn/reactnative/modules/update/UpdateContext.java'
);
const apple = read('ios/RCTPakta/RCTPakta.mm').replace(
  /^#include "(RCTPakta[^"/]+\.inc)"$/gm,
  (_, file) => read(`ios/RCTPakta/${file}`).replace(/\n$/, '')
);
const harmony = read('harmony/pakta/src/main/ets/UpdateContext.ts');
const protectedKeys = [
  'uuid',
  'nativeConfig',
  'bundleHashCache',
  'nativeCheckIncomplete',
  'binaryChannel',
  'host.setting',
];
const obsoleteKeys = [
  'hash_old',
  'hash_orphan',
  'firstLoadMarked',
  'nativeCheckResp',
];

function seed() {
  return new Map(
    [...protectedKeys, ...obsoleteKeys].map((key) => [key, `value:${key}`])
  );
}

function assertClean(values: Map<string, string>, orphans = false) {
  for (const key of protectedKeys) expect(values.get(key)).toBe(`value:${key}`);
  for (const key of obsoleteKeys) {
    expect(values.has(key)).toBe(orphans && key.startsWith('hash_'));
  }
}

describe('T12 old-layout version-scoped cleanup', () => {
  test('Android executes selective removal, never whole-store clear', () => {
    expect(android).not.toMatch(/editor\.clear\(/);
    const body = android.match(
      / {4}private void clearVersionScopedState\(SharedPreferences.Editor editor\) \{[\s\S]*?^ {4}\}/m
    )?.[0];
    expect(body).toBeDefined();
    const values = seed();
    const javascript = body!
      .replace(
        'private void clearVersionScopedState(SharedPreferences.Editor editor)',
        'function clearVersionScopedState(editor)'
      )
      .replace(
        'for (String key : sp.getAll().keySet())',
        'for (const key of sp.getAll().keySet())'
      )
      .replace(/key\.equals\(([^)]+)\)/g, 'key === $1')
      .replace(/NativeCheckOrchestrator.KEY_RESP_CACHE/g, '"nativeCheckResp"')
      .replace(/KEY_FIRST_LOAD_MARKED/g, '"firstLoadMarked"');
    runInNewContext(`${javascript}; clearVersionScopedState(editor);`, {
      sp: { getAll: () => ({ keySet: () => [...values.keys()] }) },
      editor: { remove: (key: string) => values.delete(key) },
    });
    assertClean(values);
    expect(android.match(/clearVersionScopedState\(editor\);/g)).toHaveLength(
      2
    );
    expect(android).toContain(
      'editor.putString(KEY_BINARY_CHANNEL, getChannel())'
    );
  });

  for (const enumeration of ['available', 'missing', 'throws']) {
    test(`Harmony real cleanup preserves install data when enumeration ${enumeration}`, () => {
      const body = harmony.match(
        / {2}private clearVersionScopedState\(\): void \{[\s\S]*?^ {2}\}/m
      )?.[0];
      expect(body).toBeDefined();
      const values = seed();
      const preferences = {
        deleteSync: (key: string) => values.delete(key),
        ...(enumeration === 'missing'
          ? {}
          : {
              getAllSync: () => {
                if (enumeration === 'throws') throw new Error('unavailable');
                return Object.fromEntries(values);
              },
            }),
      };
      const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(
        `class Store { ${body} }; Store;`
      );
      const Store = runInNewContext(`${javascript}\nStore;`, {
        KEY_RESP_CACHE: 'nativeCheckResp',
        TAG: 'test',
        logger: { error() {} },
        getErrorMessage: String,
      });
      const store = new Store();
      store.preferences = preferences;
      store.optionalPreferencesApi = () => preferences;
      store.clearVersionScopedState();
      assertClean(values, enumeration !== 'available');
      expect(harmony.match(/this.clearVersionScopedState\(\);/g)).toHaveLength(
        2
      );
      expect(harmony).not.toMatch(/preferences\.clear\(/);
    });
  }

  for (const reset of [false, true]) {
    test(`Apple real selective helper preserves breadcrumb and host defaults on ${reset ? 'reset' : 'binary/channel'}`, () => {
      const body = apple.match(
        /^static void PaktaClearVersionScopedState\(NSUserDefaults \*defaults, BOOL reset\) \{[\s\S]*?^\}/m
      )?.[0];
      expect(body).toBeDefined();
      const values = seed();
      values.set('packageUpdated', 'true');
      const javascript = body!
        .replace(
          'static void PaktaClearVersionScopedState(NSUserDefaults *defaults, BOOL reset)',
          'function clear(defaults, reset)'
        )
        .replace(
          'for (NSString *key in [defaults dictionaryRepresentation].allKeys)',
          'for (const key of defaults.keys())'
        )
        .replace(/\[key hasPrefix:keyHashInfo\]/g, 'key.startsWith("hash_")')
        .replace(
          /\[defaults removeObjectForKey:([^\]]+)\]/g,
          'defaults.remove($1)'
        );
      runInNewContext(`${javascript}; clear(defaults, reset);`, {
        defaults: {
          keys: () => [...values.keys()],
          remove: (key: string) => values.delete(key),
        },
        keyFirstLoadMarked: 'firstLoadMarked',
        keyNativeCheckCache: 'nativeCheckResp',
        KeyPackageUpdatedMarked: 'packageUpdated',
        reset,
      });
      assertClean(values);
      expect(values.has('packageUpdated')).toBe(!reset);
      expect(apple).toContain('PaktaClearVersionScopedState(defaults, NO)');
      expect(apple).toContain('PaktaClearVersionScopedState(defaults, YES)');
      expect(apple).not.toContain(
        '[defaults removeObjectForKey:keyNativeCheckIncomplete];\n        } else if (sync.changed)'
      );
    });
  }

  for (const event of ['reset', 'binary', 'channel']) {
    test(`Harmony ${event} clears legacy state with one flush and remains readable by the old layout`, async () => {
      const values = seed() as Map<string, unknown>;
      for (const key of [
        'currentVersion',
        'lastVersion',
        'rolledBackVersion',
      ]) {
        values.set(key, 'old');
      }
      values.set('firstTime', true);
      values.set('firstTimeOk', false);
      let flushes = 0;
      const cleanups: unknown[][] = [];
      const preferences = {
        getSync: (key: string, fallback: unknown) =>
          values.get(key) ?? fallback,
        putSync: (key: string, value: unknown) => values.set(key, value),
        deleteSync: (key: string) => values.delete(key),
        getAllSync: () => Object.fromEntries(values),
        flush: async () => {
          flushes++;
        },
      };
      const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(
        harmony
          .replace(/^import[\s\S]*?;\r?\n/gm, '')
          .replace(
            /^export\s*(?:type\s*)?\{[^}]*\}(?:\s*from\s*[^;]*)?;\r?\n/gm,
            ''
          )
          .replace(/^export /gm, '')
      );
      const store = runInNewContext(
        `${javascript}\nconst store = Object.create(UpdateContext.prototype);
        store.preferences = preferences; store.flushBatchDepth = 0;
        store.trace = () => {}; store.getPackageVersion = () => '2.0';
        store.getBuildTime = () => 'new-build'; store.getChannel = () => 'new-channel';
        store.cleanUp = () => {}; store.enqueueSerialTask = task => Promise.resolve().then(task);
        UpdateContext.launchVersion = 'running'; store;`,
        {
          preferences,
          KEY_RESP_CACHE: 'nativeCheckResp',
          TAG: 'test',
          logger: { error() {}, info() {} },
          getErrorMessage: String,
          NativePatchCore: {
            syncStateWithBinaryVersion: () => ({
              packageVersion: '2.0',
              buildTime: 'new-build',
              currentVersion: '',
              lastVersion: '',
              rolledBackVersion: '',
              firstTime: false,
              firstTimeOk: true,
              changed: true,
            }),
            cleanupOldEntries: (...args: unknown[]) => {
              cleanups.push(args);
            },
          },
        }
      );
      if (event === 'reset') await store.resetToPackagedBundle();
      else
        store.syncStateWithBinaryVersion(
          '2.0',
          'new-build',
          event === 'channel'
        );
      await Promise.resolve();
      expect(flushes).toBe(1);
      for (const key of protectedKeys.filter(
        (key) => key !== 'binaryChannel'
      )) {
        expect(values.get(key)).toBe(`value:${key}`);
      }
      for (const key of [
        ...obsoleteKeys,
        'currentVersion',
        'lastVersion',
        'rolledBackVersion',
      ]) {
        expect(values.has(key)).toBe(false);
      }
      expect(values.get('firstTime')).toBe(false);
      expect(values.get('firstTimeOk')).toBe(true);
      expect(values.get('packageVersion')).toBe('2.0');
      expect(values.get('buildTime')).toBe('new-build');
      if (event === 'reset') {
        expect(values.get('binaryChannel')).toBe('new-channel');
        expect(cleanups[0]?.slice(1)).toEqual([['running'], 0]);
      }
    });
  }

  test('existing serial directory cleanup and running-bundle protection remain in place', () => {
    expect(android).toContain('params.maxAgeDays = 0;');
    expect(android).toContain('enqueue(params);');
    expect(harmony).toContain('[UpdateContext.launchVersion].filter');
    expect(harmony).toContain('this.enqueueSerialTask(() =>');
    expect(apple).toContain('keepVersion = paktaLaunchVersion;');
    expect(apple).toContain('dispatch_async(_fileQueue, ^{');
    expect(apple).toContain(
      'std::vector<std::string>{PaktaToStdString(keepVersion)}'
    );
  });
});
