#!/usr/bin/env node
/**
 * [INPUT]: 依赖环境变量 RELEASE_VERSION、本仓库 package.json 与 Harmony HAR 发布元数据
 * [OUTPUT]: 校验发布 tag、SDK、oh-package.json5 与 BuildProfile.ets 版本同构，否则失败退出
 * [POS]: 独立 SDK 仓库的发版一致性守门脚本，不依赖兄弟 CLI 检出
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
// The release tag (vX.Y.Z) must be the package.json version being published:
// a mismatch means the tag points at the wrong commit or the version bump
// was forgotten, and npm would happily publish under the stale number.
const pkg = require('../package.json');
const tag = process.env.RELEASE_VERSION || '';
if (!tag) {
  console.error('check-release-version: RELEASE_VERSION is not set');
  process.exit(1);
}
const expected = `v${pkg.version}`;
if (tag !== expected && tag !== pkg.version) {
  console.error(
    `check-release-version: tag ${tag} does not match package.json version ${pkg.version}`
  );
  process.exit(1);
}

// The Harmony HAR carries its own version (oh-package.json5); consumers'
// oh-package-lock.json5 and diagnostics can only tell installs apart when it
// tracks package.json. scripts/build-harmony-har.js rewrites it before
// assembleHar, and this check keeps the committed value from drifting.
const fs = require('node:fs');
const path = require('node:path');
const ohPackagePath = path.join(
  __dirname,
  '..',
  'harmony/pakta/oh-package.json5'
);
const ohPackage = fs.readFileSync(ohPackagePath, 'utf8');
// JSON5 allows the key bare or quoted; the regex is shared in spirit with
// syncOhPackageVersion in scripts/build-harmony-har.js.
const ohVersion = (ohPackage.match(
  /^\s*(?:"version"|'version'|version)\s*:\s*['"]([^'"]+)['"]/m
) || [])[1];
if (ohVersion !== pkg.version) {
  console.error(
    `check-release-version: harmony/pakta/oh-package.json5 version ${ohVersion} does not match package.json version ${pkg.version}`
  );
  process.exit(1);
}

const buildProfilePath = path.join(
  __dirname,
  '..',
  'harmony/pakta/BuildProfile.ets'
);
const buildProfile = fs.readFileSync(buildProfilePath, 'utf8');
const buildProfileVersion = (buildProfile.match(
  /^\s*export const HAR_VERSION\s*=\s*['"]([^'"]+)['"]/m
) || [])[1];
if (buildProfileVersion !== pkg.version) {
  console.error(
    'check-release-version: BuildProfile.ets version ' +
      buildProfileVersion +
      ' does not match package.json version ' +
      pkg.version
  );
  process.exit(1);
}
console.log(
  'check-release-version: ' +
    tag +
    ' matches package.json, oh-package.json5 and BuildProfile.ets ' +
    pkg.version
);
