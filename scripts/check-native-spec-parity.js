#!/usr/bin/env node
/**
 * [INPUT]: 依赖 fs/path 读取 NativePakta.ts 规格与四端绑定（oldarch/newarch/RCTPakta.mm/Harmony cpp+ets）
 * [OUTPUT]: 校验 Spec 每个方法在四端导出且 Promise 方法注册为 ASYNC，漂移即失败退出
 * [POS]: scripts 的跨端方法契约守门脚本，防止能力静默降级为"旧原生"
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
// Guards the JS <-> native method contract against drift.
//
// src/NativePakta.ts is the single spec. Every method it declares must be
// exposed by all four native bindings, and the Harmony C++ method table must
// register Promise-returning methods as ASYNC (a Promise handed through a
// SYNC registration reaches JS as an empty object and its rejection is lost).
// A method missing on one platform is `undefined` on the JS side, and the JS
// feature-detects then treat the whole capability as "old native" and skip it
// silently — exactly how the native cold-start check shipped dark on Harmony
// for three releases (NATIVE_CHECK_FOLLOWUPS.md, 2026-08-13).
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const spec = read('src/NativePakta.ts');
const specBody = spec.slice(spec.indexOf('interface Spec'));
// `name(args): ReturnType;` declarations at one indent level inside Spec.
const methodRe = /^\s{2}([a-zA-Z]+)\(([^)]*)\)\s*:\s*([^;]+);/gm;
const methods = [];
let m;
while ((m = methodRe.exec(specBody)) !== null) {
  methods.push({ name: m[1], returns: m[3].trim() });
}
if (methods.length < 10) {
  console.error('check-native-spec-parity: failed to parse src/NativePakta.ts');
  process.exit(1);
}

// Bridge plumbing that RN itself calls; not part of the Pakta surface.
const plumbing = new Set(['addListener', 'removeListeners']);

const oldarch = read(
  'android/src/oldarch/cn/reactnative/modules/update/UpdateModule.java'
);
const newarch = read(
  'android/src/newarch/cn/reactnative/modules/update/UpdateModule.java'
);
const ios = read('ios/RCTPakta/RCTPakta.mm');
const harmonyCpp = read('harmony/pakta/src/main/cpp/PaktaTurboModule.cpp');
const harmonyTs = read('harmony/pakta/src/main/ets/PaktaTurboModule.ts');

const has = (source, re) => re.test(source);
const problems = [];

for (const { name, returns } of methods) {
  if (plumbing.has(name)) {
    continue;
  }
  const javaRe = new RegExp(`public\\s+\\S+\\s+${name}\\s*\\(`);
  if (!has(oldarch, javaRe)) {
    problems.push(`android/oldarch: ${name} not exported`);
  }
  if (!has(newarch, javaRe)) {
    problems.push(`android/newarch: ${name} not exported`);
  }
  if (
    !has(ios, new RegExp(`RCT_(EXPORT|REMAP)_METHOD\\(\\s*${name}\\b`)) &&
    !has(ios, new RegExp(`^-\\s*\\([^)]*\\)\\s*${name}\\b`, 'm'))
  ) {
    problems.push(`ios: ${name} not exported`);
  }
  const syncReg = new RegExp(`PAKTA_SYNC_METHOD\\(${name}\\)`);
  const asyncReg = new RegExp(`PAKTA_ASYNC_METHOD\\(${name}\\)`);
  const registered = new RegExp(`registerMethod\\(\\s*"${name}"`);
  if (!has(harmonyCpp, registered)) {
    problems.push(`harmony/cpp: ${name} not in registerMethod table`);
  }
  const isPromise = /^Promise</.test(returns);
  if (isPromise && !has(harmonyCpp, asyncReg)) {
    problems.push(
      `harmony/cpp: ${name} returns ${returns} in the spec but is not ` +
        'registered with PAKTA_ASYNC_METHOD'
    );
  }
  if (!isPromise && !has(harmonyCpp, syncReg) && !has(harmonyCpp, asyncReg)) {
    problems.push(`harmony/cpp: ${name} has no PAKTA_*_METHOD host function`);
  }
  const tsRe = new RegExp(`^\\s{2}(?:async\\s+)?${name}\\s*\\(`, 'm');
  if (!has(harmonyTs, tsRe)) {
    problems.push(`harmony/ets: ${name} not implemented`);
  }
  // A sync registration must not wrap an async ArkTS implementation.
  const tsAsync = new RegExp(`^\\s{2}async\\s+${name}\\s*\\(`, 'm');
  if (has(harmonyCpp, syncReg) && has(harmonyTs, tsAsync)) {
    problems.push(
      `harmony: ${name} is async in ArkTS but registered PAKTA_SYNC_METHOD`
    );
  }
}

if (problems.length > 0) {
  console.error(
    `check-native-spec-parity: ${problems.length} problem(s) across ` +
      `${methods.length} spec methods`
  );
  for (const p of problems) {
    console.error(`  - ${p}`);
  }
  process.exit(1);
}
console.log(
  `check-native-spec-parity: ${methods.length} spec methods present on ` +
    'android (old+new arch), ios and harmony'
);
