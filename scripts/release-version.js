#!/usr/bin/env node
/**
 * [INPUT]: 依赖显式 SemVer、本仓库 package.json 与 Harmony HAR 元数据
 * [OUTPUT]: 统一写入 SDK 与 Harmony HAR 的发布版本；--check 只读校验版本同构
 * [POS]: 独立 SDK 仓库的版本入口，以本仓库 package.json 为事实源，不读写兄弟 CLI 或示例应用
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const semverPattern =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const versionSource = 'package.json';
const packageFiles = ['package.json'];
const harmonyPackagePath = 'harmony/pakta/oh-package.json5';
const buildProfilePath = 'harmony/pakta/BuildProfile.ets';
const harmonyPackageVersionPattern =
  /^([ \t]*version[ \t]*:[ \t]*['"])([^'"]+)(['"][ \t]*,?[ \t]*)(?=\r?$)/m;
const buildProfileVersionPattern =
  /^([ \t]*export const HAR_VERSION = ['"])([^'"]+)(['"];?[ \t]*)(?=\r?$)/m;

function absolute(relativePath) {
  return path.join(repoRoot, relativePath);
}

function readText(relativePath) {
  return fs.readFileSync(absolute(relativePath), 'utf8');
}

function writeTextIfChanged(relativePath, previous, next) {
  if (previous === next) return false;
  fs.writeFileSync(absolute(relativePath), next, 'utf8');
  return true;
}

function writeJsonVersion(relativePath, version) {
  const previous = readText(relativePath);
  const packageJson = JSON.parse(previous);
  packageJson.version = version;
  const eol = previous.includes('\r\n') ? '\r\n' : '\n';
  const next = JSON.stringify(packageJson, null, 2) + eol;
  return writeTextIfChanged(relativePath, previous, next);
}

function replaceVersion(relativePath, pattern, version) {
  const previous = readText(relativePath);
  const match = previous.match(pattern);
  if (!match) {
    throw new Error(`version field not found in ${relativePath}`);
  }
  const next = previous.replace(
    pattern,
    (_line, prefix, _previousVersion, suffix) => prefix + version + suffix
  );
  return writeTextIfChanged(relativePath, previous, next);
}

function packageVersion(relativePath) {
  return JSON.parse(readText(relativePath)).version;
}

function readHarmonyVersions() {
  const harmonyPackage = readText(harmonyPackagePath).match(
    harmonyPackageVersionPattern
  );
  const buildProfile = readText(buildProfilePath).match(
    buildProfileVersionPattern
  );
  if (!harmonyPackage || !buildProfile) {
    throw new Error('Harmony release metadata is missing a version field');
  }
  return {
    harmonyPackage: harmonyPackage[2].trim(),
    buildProfile: buildProfile[2].trim(),
  };
}

function checkVersion() {
  const versions = packageFiles.map((file) => ({
    file: file,
    version: packageVersion(file),
  }));
  const harmony = readHarmonyVersions();
  const expected = versions[0].version;
  const mismatches = versions
    .filter((item) => item.version !== expected)
    .map((item) => `${item.file}=${item.version}`);
  if (harmony.harmonyPackage !== expected) {
    mismatches.push(`${harmonyPackagePath}=${harmony.harmonyPackage}`);
  }
  if (harmony.buildProfile !== expected) {
    mismatches.push(`${buildProfilePath}=${harmony.buildProfile}`);
  }
  if (mismatches.length > 0) {
    throw new Error(
      'release versions are inconsistent; expected ' +
        expected +
        ': ' +
        mismatches.join(', ')
    );
  }
  console.log(`release-version: ${expected} is consistent`);
}

function syncVersion(version) {
  const changed = [];
  for (const file of packageFiles) {
    if (writeJsonVersion(file, version)) changed.push(file);
  }
  if (
    replaceVersion(harmonyPackagePath, harmonyPackageVersionPattern, version)
  ) {
    changed.push(harmonyPackagePath);
  }
  if (replaceVersion(buildProfilePath, buildProfileVersionPattern, version)) {
    changed.push(buildProfilePath);
  }
  if (changed.length === 0) {
    console.log(`release-version: already at ${version}`);
  } else {
    console.log(`release-version: synchronized ${version}`);
    for (const file of changed) console.log(`  updated ${file}`);
  }
}

function main() {
  const argument = process.argv[2];
  if (argument === '--check' || argument === 'check') {
    checkVersion();
    return;
  }

  const requestedVersion = argument || process.env.RELEASE_VERSION;
  const version = String(requestedVersion || packageVersion(versionSource))
    .trim()
    .replace(/^v/, '');
  if (!semverPattern.test(version)) {
    throw new Error(
      'invalid release version "' +
        version +
        '"; expected X.Y.Z with optional prerelease/build metadata'
    );
  }
  syncVersion(version);
  checkVersion();
}

try {
  main();
} catch (error) {
  console.error(`release-version: ${error.message}`);
  process.exitCode = 1;
}
