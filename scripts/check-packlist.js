#!/usr/bin/env node
/**
 * [INPUT]: 依赖候选 tgz/可选 SHA-256，或 build-types.js 与 npm pack --dry-run；必备 ABI 清单由 contract.json 派生
 * [OUTPUT]: 校验声明闭包、运行源码、旧桥 NativePaktaSpec.java 与 Harmony PaktaMethods.inc 必备清单、禁止模式和四 ABI，--release 时额外要求 Harmony HAR
 * [POS]: scripts 的发包内容守门脚本，lint CI 与 npm publish 前运行
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
// Guards the published file list (npm pack --dry-run) against drift: the
// package.json `files` whitelist decides what ships, this check decides what
// must and must not be there. Run in lint CI and right before `npm publish`
// (with --release, which additionally requires the Harmony HAR).
const { execFileSync } = require('child_process');
const { readdirSync } = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { readCandidate, candidateHash } = require('./package-candidate');
const { mkdtempSync, writeFileSync } = require('node:fs');
const os = require('node:os');

const root = path.resolve(__dirname, '..');
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { release: { type: 'boolean' }, sha256: { type: 'string' } },
});
if (positionals.length > 1 || (values.sha256 && !positionals.length)) {
  throw new Error('expected one candidate tgz for --sha256');
}
const candidate = positionals.length ? readCandidate(positionals[0], values.sha256) : null;
if (!candidate) {
  execFileSync(process.execPath, [path.join(__dirname, 'build-types.js')], {
    cwd: root, stdio: 'inherit',
  });
}

const release = values.release;

const allowedPrefixes = [
  'dist/types/',
  'src/',
  'android/src/',
  'android/lib/',
  'android/jni/',
  'android/build.gradle',
  'android/proguard.pro',
  'ios/',
  'cpp/patch_core/',
  'cpp/update_flow_core/',
  'harmony/pakta.har',
  'harmony/hvigor-plugin.ts',
  'harmony/pakta/src/',
  'rn-update.podspec',
  'react-native.config.js',
  'expo-module.config.json',
  'app.plugin.js',
  'check-expo-version.js',
  'package.json',
  'README.md',
  'README-CN.md',
  'LICENSE',
  'readme-banner.svg',
];

const forbidden = [
  /(^|\/)(tests?|__tests__)\//,
  /(^|\/)(build|oh_modules|node_modules|\.hvigor|\.cxx|\.gradle)(\/|$)/,
  /^Example\//,
  /^scripts\//,
  /^\.github\//,
  /^\.gitmodules$/,
  /^biome\.json$/,
  /^tsconfig(?:\.[^.]+)?\.json$/,
  /^dist\/(?!types\/.*\.d\.ts$)/,
  /^(BUNDLEHASH|NATIVE_CHECK|CODE_AUDIT)[A-Z_]*\.md$/,
  /\.(log|tgz|zip|ppk|apk)$/,
];

const required = [
  'package.json',
  'dist/types/index.d.ts',
  'src/index.ts',
  'src/NativePakta.ts',
  'android/build.gradle',
  'android/src/main/java/cn/reactnative/modules/update/UpdateContext.java',
  'android/src/oldarch/cn/reactnative/modules/update/NativePaktaSpec.java',
  'android/jni/hpatch.c',
  'ios/RCTPakta/RCTPakta.mm',
  'rn-update.podspec',
  'cpp/patch_core/patch_core.cpp',
  'cpp/patch_core/archive_limits.h',
  'cpp/patch_core/install_record.h',
  'cpp/patch_core/install_record.cpp',
  'cpp/patch_core/archive_limits.cpp',
  'cpp/patch_core/patch_manifest.h',
  'cpp/patch_core/patch_manifest.cpp',
  'cpp/patch_core/resume_plan.h',
  'cpp/patch_core/resume_plan.cpp',
  'cpp/patch_core/resume_plan_android.cpp',
  'android/jni/native_install_jni.cpp',
  'android/jni/native_round_jni.cpp',
  'android/src/main/java/cn/reactnative/modules/update/NativeInstall.java',
  'android/src/main/java/cn/reactnative/modules/update/ResumePlan.java',
  'android/src/main/java/cn/reactnative/modules/update/AndroidRound.java',
  'android/src/main/java/cn/reactnative/modules/update/DeviceRound.java',
  'cpp/update_flow_core/update_flow_core.cpp',
  'cpp/update_flow_core/native_config.h',
  'cpp/update_flow_core/native_config.cpp',
  'cpp/update_flow_core/native_round.h',
  'cpp/update_flow_core/native_round.cpp',
  'cpp/update_flow_core/round_engine.h',
  'cpp/update_flow_core/round_engine.cpp',
  'harmony/pakta/src/main/ets/PaktaTurboModule.ts',
  'harmony/pakta/src/main/ets/HarmonyRound.ts',
  'harmony/pakta/src/main/cpp/install_napi.h',
  'harmony/pakta/src/main/cpp/resume_napi.h',
  'harmony/pakta/src/main/cpp/round_napi.h',
  'harmony/pakta/src/main/cpp/PaktaMethods.inc',
  'harmony/hvigor-plugin.ts',
  'expo-module.config.json',
  'app.plugin.js',
  'check-expo-version.js',
  'react-native.config.js',
  ...(release ? ['harmony/pakta.har'] : []),
];
const requiredAbis = ["arm64-v8a","armeabi-v7a","x86","x86_64"];
for (const file of readdirSync(path.join(root, 'ios/RCTPakta'))) {
  if (file.startsWith('RCTPakta') && file.endsWith('.inc')) {
    required.push(`ios/RCTPakta/${file}`);
  }
}

// Windows 的 npm 入口是 npm.cmd，Node 的 spawn 不会替 PowerShell 别名补全扩展名。
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const json = candidate ? null : execFileSync(
  npmCommand,
  ['pack', '--dry-run', '--json', '--ignore-scripts'],
  {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    shell: process.platform === 'win32',
  }
);
// npm <= 11 prints an array of packed tarballs; npm 12 prints an object
// keyed by package name. Accept both.
const parsed = json && JSON.parse(json);
const packed = parsed && (Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0]);
const files = candidate ? candidate.files : packed.files.map((f) => f.path);
const set = new Set(files);
const problems = require('./package-source-closure').checkNativePacklist(files, candidate);
const metadata = candidate ? candidate.metadata : require('../package.json');
if (metadata.types !== 'dist/types/index.d.ts') {
  problems.push('types must resolve to dist/types/index.d.ts');
}
for (const file of candidate ? [] : readdirSync(path.join(root, 'dist/types'), {
  recursive: true,
})) {
  if (file.endsWith('.d.ts')) {
    required.push(`dist/types/${file.split(path.sep).join('/')}`);
  }
}

for (const file of files) {
  if (!allowedPrefixes.some((p) => file === p || file.startsWith(p))) {
    problems.push(`not whitelisted: ${file}`);
  }
  if (forbidden.some((re) => re.test(file))) {
    problems.push(`forbidden: ${file}`);
  }
}
for (const file of required) {
  if (!set.has(file)) {
    problems.push(`missing: ${file}`);
  }
}
for (const abi of requiredAbis) {
  if (!set.has(`android/lib/${abi}/librnupdate.so`)) {
    problems.push(`missing: android/lib/${abi}/librnupdate.so`);
  }
}

if (problems.length > 0) {
  console.error(
    `check-packlist: ${problems.length} problem(s) in ${files.length} files`
  );
  for (const p of problems) {
    console.error(`  - ${p}`);
  }
  process.exit(1);
}
if (release) {
  let har = path.join(root, 'harmony/pakta.har');
  if (candidate) {
    har = path.join(mkdtempSync(path.join(os.tmpdir(), 'pakta-har-')), 'pakta.har');
    writeFileSync(har, execFileSync('tar', ['-xOf', candidate.tarball, 'package/harmony/pakta.har'], {
      maxBuffer: 128 * 1024 * 1024,
    }));
  }
  execFileSync(process.platform === 'win32' ? 'python' : 'python3', [
    '-B', path.join(__dirname, 'check-harmony-har.py'), har,
    '--version', process.env.EXPECTED_HAR_VERSION || metadata.version,
  ], { stdio: 'inherit' });
}
if (candidate && candidateHash(candidate.tarball) !== candidate.sha256) {
  throw new Error('candidate SHA-256 changed during packlist validation');
}
console.log(
  `check-packlist: ${files.length} files OK${release ? ' (release)' : ''}`
);
