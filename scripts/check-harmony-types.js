#!/usr/bin/env node
/**
 * [INPUT]: 依赖 DEVECO_SDK_HOME 或默认 SDK 路径、harmony/pakta/oh_modules 与仓库 TypeScript 编译器
 * [OUTPUT]: 按 Harmony SDK 路径生成临时 harmony/.tsconfig.harmony.json 并执行严格 ETS 类型检查；缺少 SDK/依赖时显式跳过
 * [POS]: scripts 的 Harmony 声明静态校验入口，守住 ArkTS/RNOH 类型边界而不改变源码或生成发布产物
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 *
 * Type-checks the HarmonyOS TS sources (harmony/pakta/src/main/ets) with tsc.
 *
 * The root tsconfig excludes harmony/ because these files need the HarmonyOS
 * SDK type declarations (@ohos.* / @kit.*) and the RNOH types from oh_modules.
 * This script locates a locally installed DevEco SDK, generates a tsconfig
 * with the right path mappings, and runs tsc against it. When no SDK is
 * available (e.g. CI runners), the check is skipped with a notice instead of
 * failing, so it never blocks environments that cannot have the SDK.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const harmonyDir = path.join(repoRoot, 'harmony');
const ohModules = path.join(harmonyDir, 'pakta', 'oh_modules');
const generatedConfigPath = path.join(harmonyDir, '.tsconfig.harmony.json');

function findSdkEtsDir() {
  // CI containers lay the SDK out differently from DevEco; let them point
  // straight at the `ets` directory (the one containing `api/` and `kits/`).
  const explicit = process.env.HARMONY_SDK_ETS_DIR;
  if (explicit) {
    if (fs.existsSync(path.join(explicit, 'api'))) {
      return explicit;
    }
    // A stale override must not hide a valid DEVECO_SDK_HOME / default
    // install: say so and keep probing.
    console.warn(
      `check-harmony-types: HARMONY_SDK_ETS_DIR=${explicit} has no api/ dir; ` +
        'ignoring it and probing the default SDK locations.'
    );
  }
  const bases = [];
  if (process.env.DEVECO_SDK_HOME) {
    bases.push(process.env.DEVECO_SDK_HOME);
  }
  bases.push(
    '/Applications/DevEco-Studio.app/Contents/sdk',
    path.join(process.env.HOME || '', 'Library/OpenHarmony/Sdk')
  );

  for (const base of bases) {
    if (!base || !fs.existsSync(base)) {
      continue;
    }
    const candidates = [path.join(base, 'default', 'openharmony', 'ets')];
    // Version-numbered SDK layouts (e.g. ~/Library/OpenHarmony/Sdk/11/ets).
    for (const entry of fs.readdirSync(base)) {
      candidates.push(
        path.join(base, entry, 'openharmony', 'ets'),
        path.join(base, entry, 'ets')
      );
    }
    for (const candidate of candidates) {
      if (fs.existsSync(path.join(candidate, 'api'))) {
        return candidate;
      }
    }
  }
  return null;
}

// On developer machines without DevEco the check skips; in the HarmonyOS CI
// container (HARMONY_TYPECHECK_REQUIRED=1) a missing SDK or oh_modules is a
// misconfiguration and must fail instead of silently passing.
const required = process.env.HARMONY_TYPECHECK_REQUIRED === '1';
const skipOrFail = (reason) => {
  if (required) {
    console.error(`check-harmony-types: ${reason} (required in CI).`);
    process.exit(1);
  }
  console.log(`check-harmony-types: ${reason}, skipping harmony type check.`);
  process.exit(0);
};

const sdkEts = findSdkEtsDir();
if (!sdkEts) {
  skipOrFail(
    'no DevEco/OpenHarmony SDK found (set DEVECO_SDK_HOME to enable)'
  );
}
if (!fs.existsSync(ohModules)) {
  skipOrFail('harmony/pakta/oh_modules not installed');
}

const config = {
  compilerOptions: {
    target: 'ES2021',
    module: 'ESNext',
    moduleResolution: 'bundler',
    lib: ['ES2021'],
    types: [],
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    forceConsistentCasingInFileNames: true,
    paths: {
      // @rnoh and librnupdate.so are stubbed in types/ (see comments there);
      // @ohos/@kit resolve to the real SDK declarations.
      '@ohos.*': [path.join(sdkEts, 'api', '@ohos.*')],
      '@kit.*': [path.join(sdkEts, 'kits', '@kit.*')],
    },
  },
  include: ['pakta/src/main/ets/**/*.ts', 'types/**/*.d.ts'],
};

fs.writeFileSync(generatedConfigPath, JSON.stringify(config, null, 2));

const tscBin = path.join(
  path.dirname(
    require.resolve('typescript/package.json', { paths: [repoRoot] })
  ),
  'bin/tsc'
);
const result = spawnSync(
  process.execPath,
  [tscBin, '-p', generatedConfigPath],
  {
    stdio: 'inherit',
  }
);

if (result.status !== 0) {
  console.error('check-harmony-types: harmony type check failed.');
  process.exit(result.status || 1);
}
console.log('check-harmony-types: harmony type check passed.');
