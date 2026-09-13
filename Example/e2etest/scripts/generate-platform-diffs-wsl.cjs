#!/usr/bin/env node
/**
 * [INPUT]: 依赖 WSL/Linux Node、rn-update-cli >=1.0.0、node-hdiffpatch 与目标平台完整 PPK/APK 制品
 * [OUTPUT]: 对外提供 Android/Harmony 真实差分生成器，按平台拓扑写入 ppk/package/v2-track patch 及 manifest
 * [POS]: Windows 开发机的原生 hdiff 旁路；以显式平台选择约束差分基线，防止跨平台复用错误 origin
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

const fs = require('node:fs');
const path = require('node:path');

const cliRoot = process.env.RNU_WSL_CLI_ROOT;
const hdiffRoot = process.env.RNU_WSL_HDIFF_ROOT;
const artifactDir = process.env.RNU_WSL_ARTIFACT_DIR;
const platform = process.env.RNU_WSL_PLATFORM;

if (!cliRoot || !hdiffRoot || !artifactDir || !platform) {
  throw new Error(
    'RNU_WSL_CLI_ROOT, RNU_WSL_HDIFF_ROOT, RNU_WSL_ARTIFACT_DIR and RNU_WSL_PLATFORM are required',
  );
}

if (platform !== 'android' && platform !== 'harmony') {
  throw new Error(
    `RNU_WSL_PLATFORM must be android or harmony, received: ${platform}`,
  );
}

function requireFile(filePath, label) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`${label} not found: ${filePath}`);
  }
}

function verifyFile(filePath, label) {
  requireFile(filePath, label);
  const size = fs.statSync(filePath).size;
  if (size <= 0) {
    throw new Error(`${label} is empty: ${filePath}`);
  }
  console.log(`verified ${label}: ${filePath} (${size} bytes)`);
}

function loadDiffCommands() {
  const cliPackagePath = path.join(cliRoot, 'package.json');
  requireFile(cliPackagePath, 'rn-update-cli package.json');
  const cliPackage = JSON.parse(fs.readFileSync(cliPackagePath, 'utf8'));
  const cliExports = require(path.join(cliRoot, 'lib/exports.js'));
  const diffCommands = cliExports.diffCommands;
  if (
    !diffCommands ||
    typeof diffCommands.hdiff !== 'function' ||
    typeof diffCommands.hdiffFromApk !== 'function'
  ) {
    throw new Error(
      `rn-update-cli ${cliPackage.version || 'unknown'} does not expose diffCommands; use >=1.0.0`,
    );
  }
  return diffCommands;
}

function loadHdiffModule() {
  const hdiffModule = require(path.join(hdiffRoot, 'node-hdiffpatch'));
  const customDiff = hdiffModule.diff || hdiffModule;
  if (
    typeof customDiff !== 'function' ||
    typeof hdiffModule.patch !== 'function' ||
    typeof hdiffModule.diffStream !== 'function' ||
    typeof hdiffModule.patchStream !== 'function'
  ) {
    throw new Error(
      'node-hdiffpatch must expose diff/patch/diffStream/patchStream',
    );
  }
  return { hdiffModule, customDiff };
}

function getManifestDefaults() {
  return {
    platform,
    hashes: {
      full: 'e2e-full-v1',
      ppkPatch: 'e2e-ppk-patch-v2',
      packagePatch: 'e2e-package-patch-v3',
      v2Track: 'e2e-v2track-v4',
    },
    labels: {
      base: 'BINARY_BASE',
      full: 'E2E_FULL_V1',
      ppkPatch: 'E2E_PPK_PATCH_V2',
      packagePatch: 'E2E_PACKAGE_PATCH_V3',
      v2Track: 'E2E_V2TRACK_V4',
    },
    files: {
      full: 'v1.ppk',
      ppkFull: 'v2.ppk',
      ppkDiff: 'v1-to-v2.ppk.patch',
      packageFull: 'v3.ppk',
      packageDiff: 'base-to-v3.apk.patch',
      v2TrackFull: 'v4.ppk',
      v2TrackDiff: 'to-v4.v2track.ppk.patch',
      apk: 'app-release.apk',
    },
  };
}

async function main() {
  const diffCommands = loadDiffCommands();
  const { hdiffModule, customDiff } = loadHdiffModule();
  const v1 = path.join(artifactDir, 'v1.ppk');
  const v2 = path.join(artifactDir, 'v2.ppk');
  const v3 = path.join(artifactDir, 'v3.ppk');
  const v4 = path.join(artifactDir, 'v4.ppk');
  const apk = path.join(artifactDir, 'app-release.apk');
  const ppkDiff = path.join(artifactDir, 'v1-to-v2.ppk.patch');
  const packageDiff = path.join(artifactDir, 'base-to-v3.apk.patch');
  const v2TrackDiff = path.join(artifactDir, 'to-v4.v2track.ppk.patch');

  [
    [v1, 'v1.ppk'],
    [v2, 'v2.ppk'],
    [v4, 'v4.ppk'],
  ].forEach(([filePath, label]) => requireFile(filePath, label));

  if (platform === 'android') {
    requireFile(v3, 'v3.ppk');
    requireFile(apk, 'app-release.apk');
  }

  await diffCommands.hdiff({
    args: [v1, v2],
    options: {
      output: ppkDiff,
      customDiff,
      'no-interactive': true,
    },
  });
  verifyFile(ppkDiff, 'v1-to-v2.ppk.patch');

  if (platform === 'android') {
    await diffCommands.hdiffFromApk({
      args: [apk, v3],
      options: {
        output: packageDiff,
        customDiff,
        'no-interactive': true,
      },
    });
    verifyFile(packageDiff, 'base-to-v3.apk.patch');
  }

  // Android 的 v2-track 紧跟 package patch(v3)；Harmony 没有 package
  // patch，必须从 ppk patch(v2) 继续。把分支留在这里，禁止调用者猜 origin。
  const v2TrackOrigin = platform === 'android' ? v3 : v2;
  await diffCommands.hdiff({
    args: [v2TrackOrigin, v4],
    options: {
      output: v2TrackDiff,
      hbcTransform: true,
      bundleStreamThreshold: 1,
      'no-interactive': true,
      customHdiffModule: {
        diff: customDiff,
        patch: hdiffModule.patch,
        diffStream: hdiffModule.diffStream,
        patchStream: hdiffModule.patchStream,
      },
    },
  });
  verifyFile(v2TrackDiff, 'to-v4.v2track.ppk.patch');

  const manifestPath = path.join(artifactDir, 'manifest.json');
  const manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    : getManifestDefaults();
  manifest.platform = platform;
  manifest.generatedAt = new Date().toISOString();
  manifest.fullFallback = false;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  verifyFile(manifestPath, 'manifest.json');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
