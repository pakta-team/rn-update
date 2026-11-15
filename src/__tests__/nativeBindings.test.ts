/**
 * [INPUT]: 依赖 Bun、临时文件系统与真实 T09 生成器/parity，不装载原生业务运行时
 * [OUTPUT]: 验证两次生成幂等、只读检查失败、签名与统一表漂移负控及不支持语法拒绝
 * [POS]: __tests__ 的 T09 契约回归；所有破坏性变异仅发生在系统临时副本
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '../..');
const generator = require('../../scripts/generate-native-bindings.js');
const parity = require('../../scripts/native-binding-parity.js');
const oldarch =
  'android/src/oldarch/cn/reactnative/modules/update/UpdateModule.java';
const newarch =
  'android/src/newarch/cn/reactnative/modules/update/UpdateModule.java';
const cpp = 'harmony/pakta/src/main/cpp/PaktaTurboModule.cpp';
const ets = 'harmony/pakta/src/main/ets/PaktaTurboModule.ts';
const ios = 'ios/RCTPakta/RCTPakta.mm';
const spec = 'src/NativePakta.ts';
const files = [
  spec,
  oldarch,
  newarch,
  cpp,
  ets,
  ios,
  ...Object.values(generator.outputs),
] as string[];

function fixture() {
  const target = mkdtempSync(path.join(os.tmpdir(), 'pakta-t09-'));
  for (const file of files) {
    mkdirSync(path.dirname(path.join(target, file)), { recursive: true });
    writeFileSync(path.join(target, file), readFileSync(path.join(root, file)));
  }
  return target;
}

function mutate(target: string, file: string, before: string, after: string) {
  const original = readFileSync(path.join(target, file), 'utf8');
  expect(original).toContain(before);
  writeFileSync(path.join(target, file), original.replace(before, after));
}

test('本地 Spec 派生 19 方法、16 Promise；两次生成无变化且 --check 只读', () => {
  const target = fixture();
  const methods = generator.generate(target);
  expect(methods).toHaveLength(19);
  expect(
    methods.filter((method: { async: boolean }) => method.async)
  ).toHaveLength(16);
  const contents = files.map((file) =>
    readFileSync(path.join(target, file), 'utf8')
  );
  generator.generate(target);
  generator.generate(target, true);
  expect(
    files.map((file) => readFileSync(path.join(target, file), 'utf8'))
  ).toEqual(contents);
  expect(parity.check(target)).toHaveLength(19);
  execFileSync('node', ['scripts/generate-native-bindings.js', '--check'], {
    cwd: root,
  });
  execFileSync('node', ['scripts/check-native-spec-parity.js'], { cwd: root });
  expect(
    spawnSync('node', ['scripts/generate-native-bindings.js', '--unknown'], {
      cwd: root,
    }).status
  ).toBe(1);
});

const mutations: [string, string, string, string, RegExp][] = [
  [
    '生成 Java 参数',
    generator.outputs.java,
    'String expectedHash',
    'Integer expectedHash',
    /Stale native bindings/,
  ],
  [
    'Harmony 参数数',
    generator.outputs.harmony,
    'markSuccess, 1, ASYNC',
    'markSuccess, 0, ASYNC',
    /Stale native bindings/,
  ],
  [
    'Harmony Promise 模式',
    generator.outputs.harmony,
    'markSuccess, 1, ASYNC',
    'markSuccess, 1, SYNC',
    /Stale native bindings/,
  ],
  [
    'Harmony 缺方法',
    generator.outputs.harmony,
    'PAKTA_METHOD(getBundleHash, 0, ASYNC)',
    '',
    /Stale native bindings/,
  ],
  [
    'Harmony 多方法',
    generator.outputs.harmony,
    'PAKTA_METHOD(getConstants, 0, SYNC)',
    'PAKTA_METHOD(extra, 0, SYNC)',
    /Stale native bindings/,
  ],
  [
    '旧 Integer 兼容',
    oldarch,
    'Integer count',
    'double count',
    /oldarch: removeListeners signature/,
  ],
  [
    '新 double 兼容',
    newarch,
    'double count',
    'Integer count',
    /newarch: removeListeners signature/,
  ],
  [
    '旧桥丢 expectedHash',
    oldarch,
    'String expectedHash, Promise promise',
    'Promise promise',
    /oldarch: markSuccess signature/,
  ],
  [
    '新桥错 Promise',
    newarch,
    'String expectedHash, Promise promise',
    'String expectedHash, String promise',
    /newarch: markSuccess signature/,
  ],
  [
    '旧桥委托错参',
    oldarch,
    'impl.markSuccess(expectedHash, promise)',
    'impl.markSuccess(null, promise)',
    /delegate arguments drifted/,
  ],
  [
    '旧桥断继承',
    oldarch,
    'extends NativePaktaSpec',
    'extends ReactContextBaseJavaModule',
    /generated Spec not inherited/,
  ],
  [
    'Harmony 错注册数量',
    cpp,
    'registerMethod(#name, arity, HostFunction_##name)',
    'registerMethod(#name, 0, HostFunction_##name)',
    /registration expansion/,
  ],
  [
    'Harmony 错 HostFunction',
    cpp,
    'PAKTA_##mode##_METHOD(name)',
    'PAKTA_SYNC_METHOD(name)',
    /HostFunction expansion/,
  ],
  [
    'Harmony 错派发',
    cpp,
    'return CallAsync(rt, turboModule',
    'return CallSync(rt, turboModule',
    /ASYNC dispatch/,
  ],
  [
    'ArkTS 错参数',
    ets,
    'markSuccess(expectedHash: string)',
    'markSuccess(expectedHash: number)',
    /markSuccess parameter/,
  ],
  [
    'ArkTS 错返回',
    ets,
    'markSuccess(expectedHash: string): Promise<boolean>',
    'markSuccess(expectedHash: string): Promise<void>',
    /markSuccess parameter/,
  ],
  [
    'Apple 丢 expectedHash',
    ios,
    'markSuccess:(NSString *)expectedHash',
    'markSuccess:(NSNumber *)expectedHash',
    /ios: markSuccess/,
  ],
];

for (const [name, file, before, after, error] of mutations) {
  test(`负控：${name} 必须失败且不自动修复`, () => {
    const target = fixture();
    mutate(target, file, before, after);
    const broken = readFileSync(path.join(target, file), 'utf8');
    expect(() => parity.check(target)).toThrow(error);
    expect(readFileSync(path.join(target, file), 'utf8')).toBe(broken);
    if (Object.values(generator.outputs).includes(file)) {
      expect(() => generator.generate(target, true)).toThrow(
        /Stale native bindings/
      );
      generator.generate(target);
      expect(parity.check(target)).toHaveLength(19);
    }
  });
}

test('AST 不依赖缩进；新方法可派生，但未实现会被 parity 拒绝', () => {
  const target = fixture();
  mutate(
    target,
    spec,
    '  addListener(eventName: string): void;',
    '  probe(value: string): Promise<boolean>;\naddListener(eventName: string): void;'
  );
  expect(() => generator.generate(target, true)).toThrow(
    /Stale native bindings/
  );
  expect(generator.generate(target)).toHaveLength(20);
  expect(() => parity.check(target)).toThrow(/probe/);
});

test('不支持类型、重复方法和无参成功确认必须显式拒绝', () => {
  const source = readFileSync(path.join(root, spec), 'utf8');
  for (const changed of [
    source.replace('markSuccess(expectedHash: string)', 'markSuccess()'),
    source.replace('setUuid(uuid: string)', 'setUuid(uuid: unknown)'),
    source.replace(
      'restartApp(): Promise<void>;',
      'restartApp(): Promise<void>; restartApp(): Promise<void>;'
    ),
    source.replace(
      'addListener(eventName: string)',
      'addListener(eventName?: string)'
    ),
  ]) {
    expect(() => generator.readMethods(changed)).toThrow();
  }
});
