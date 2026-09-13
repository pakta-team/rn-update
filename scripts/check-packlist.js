#!/usr/bin/env node
/**
 * [INPUT]: 依赖 child_process 执行 npm pack --dry-run 与 package.json files 白名单
 * [OUTPUT]: 校验发布文件清单的允许前缀/禁止模式/必备文件，--release 时额外要求 Harmony HAR
 * [POS]: scripts 的发包内容守门脚本，lint CI 与 npm publish 前运行
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
// Guards the published file list (npm pack --dry-run) against drift: the
// package.json `files` whitelist decides what ships, this check decides what
// must and must not be there. Run in lint CI and right before `npm publish`
// (with --release, which additionally requires the Harmony HAR).
const { execFileSync } = require('child_process');

const release = process.argv.includes('--release');

const allowedPrefixes = [
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
  /^(BUNDLEHASH|NATIVE_CHECK|CODE_AUDIT)[A-Z_]*\.md$/,
  /\.(log|tgz|zip|ppk|apk)$/,
];

const required = [
  'package.json',
  'src/index.ts',
  'src/NativePakta.ts',
  'android/build.gradle',
  'android/src/main/java/cn/reactnative/modules/update/UpdateContext.java',
  'android/jni/hpatch.c',
  'ios/RCTPakta/RCTPakta.mm',
  'rn-update.podspec',
  'cpp/patch_core/patch_core.cpp',
  'cpp/patch_core/archive_limits.h',
  'cpp/patch_core/install_record.h',
  'cpp/update_flow_core/update_flow_core.cpp',
  'harmony/pakta/src/main/ets/PaktaTurboModule.ts',
  'harmony/hvigor-plugin.ts',
  'expo-module.config.json',
  'react-native.config.js',
  ...(release ? ['harmony/pakta.har'] : []),
];
const requiredAbis = ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64'];

// Windows 的 npm 入口是 npm.cmd，Node 的 spawn 不会替 PowerShell 别名补全扩展名。
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const json = execFileSync(
  npmCommand,
  ['pack', '--dry-run', '--json', '--ignore-scripts'],
  {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    shell: process.platform === 'win32',
  }
);
// npm <= 11 prints an array of packed tarballs; npm 12 prints an object
// keyed by package name. Accept both.
const parsed = JSON.parse(json);
const packed = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
const files = packed.files.map((f) => f.path);
const set = new Set(files);
const problems = [];

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
console.log(
  `check-packlist: ${files.length} files OK${release ? ' (release)' : ''}`
);
