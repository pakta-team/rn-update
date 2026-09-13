#!/usr/bin/env bun
/**
 * [INPUT]: 依赖 Bun/node fs、git 标签与 RELEASE_VERSION/GITHUB_REF 环境，调用 build:harmony-har、build:so 和 verify-android-so.js
 * [OUTPUT]: 在 CI 中校验并同步 SDK/CLI/Harmony 版本，在本地/发布流程中构建原生产物并以进程状态报告发布闸门结果
 * [POS]: scripts 的 npm prepublish 总编排入口，串联版本、原生构建和 ABI 完整性检查，不定义产品更新策略
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { $ } from 'bun';

function normalizeVersion(version: string): string {
  return version
    .trim()
    .replace(/^refs\/tags\//, '')
    .replace(/^v/, '');
}

const SEMVER_REGEX = /^\d+\.\d+\.\d+(-.+)?$/;

function isValidSemver(version: string): boolean {
  return SEMVER_REGEX.test(version);
}

function getVersionFromEnvironment(): string | null {
  const candidates = [
    process.env.RELEASE_VERSION,
    process.env.CI_COMMIT_TAG,
    process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : null,
    process.env.GITHUB_REF?.startsWith('refs/tags/')
      ? process.env.GITHUB_REF
      : null,
  ];

  for (const candidate of candidates) {
    if (candidate?.trim()) {
      return normalizeVersion(candidate);
    }
  }

  return null;
}

function getShellErrorMessage(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'stderr' in error &&
    typeof error.stderr === 'string' &&
    error.stderr.trim()
  ) {
    return error.stderr.trim();
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return 'Unknown git error';
}

async function getVersionFromGit(): Promise<string> {
  try {
    return normalizeVersion(await $`git describe --tags --always`.text());
  } catch (error) {
    const message = getShellErrorMessage(error);

    if (message.includes('detected dubious ownership')) {
      throw new Error(
        'Git refused to read repository metadata because this checkout is not marked as safe. Configure safe.directory in CI or provide RELEASE_VERSION/GITHUB_REF_NAME.',
        { cause: error }
      );
    }

    throw new Error(`Unable to resolve publish version from git: ${message}`, {
      cause: error,
    });
  }
}

async function resolveVersion(): Promise<string> {
  return getVersionFromEnvironment() ?? (await getVersionFromGit());
}

async function modifyPackageJson({
  version,
}: {
  version: string;
}): Promise<void> {
  const packageJsonPath = path.join(__dirname, '..', 'package.json');

  try {
    await access(packageJsonPath);
  } catch {
    throw new Error(`package.json not found at ${packageJsonPath}`);
  }

  console.log('Reading package.json...');
  const packageJsonContent = await readFile(packageJsonPath, 'utf-8');
  const packageJson = JSON.parse(packageJsonContent);

  packageJson.version = version;

  console.log('Writing modified package.json...');

  await writeFile(
    packageJsonPath,
    JSON.stringify(packageJson, null, 2),
    'utf-8'
  );

  console.log('package.json has been modified for publishing');
}

function syncReleaseMetadata(version: string): void {
  console.log('Synchronizing SDK, CLI and Harmony release metadata...');
  const result = Bun.spawnSync(
    ['node', path.join(__dirname, 'release-version.js'), version],
    {
      cwd: path.join(__dirname, '..'),
      stdio: ['inherit', 'inherit', 'inherit'],
    }
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `Release metadata sync failed with exit code ${result.exitCode}`
    );
  }
}

function isGitHubCI(): boolean {
  return process.env.GITHUB_ACTIONS === 'true';
}

function shouldSkipNativeBuild(): boolean {
  return (
    process.argv.includes('--skip') || process.env.SKIP_NATIVE_BUILD === '1'
  );
}

async function buildNativeArtifacts(): Promise<void> {
  console.log('Building Harmony HAR...');
  const harResult = Bun.spawnSync(['npm', 'run', 'build:harmony-har'], {
    cwd: path.join(__dirname, '..'),
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  if (harResult.exitCode !== 0) {
    throw new Error(
      `Harmony HAR build failed with exit code ${harResult.exitCode}`
    );
  }

  console.log('Building Android SO...');
  const soResult = Bun.spawnSync(['npm', 'run', 'build:so'], {
    cwd: path.join(__dirname, '..'),
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  if (soResult.exitCode !== 0) {
    throw new Error(
      `Android SO build failed with exit code ${soResult.exitCode}`
    );
  }
}

async function main(): Promise<void> {
  try {
    if (isGitHubCI()) {
      const version = await resolveVersion();
      if (!isValidSemver(version)) {
        throw new Error(
          `Resolved version "${version}" is not a valid semantic version. ` +
            `Please ensure RELEASE_VERSION, GITHUB_REF, or GITHUB_REF_NAME is set correctly, ` +
            `or that the git history is fully fetched.`
        );
      }
      console.log(`Using publish version ${version}`);
      await modifyPackageJson({ version });
      syncReleaseMetadata(version);
      // Last gate for any CI publish path: publish.yml is expected to have
      // replaced android/lib with CI-built binaries by now — verify here so a
      // future workflow that skips that step can never silently ship stale
      // committed .so files. Pure Node, runs in the HarmonyOS docker image too.
      console.log('Verifying Android native libraries...');
      const verifyResult = Bun.spawnSync(
        ['node', path.join(__dirname, 'verify-android-so.js')],
        { stdio: ['inherit', 'inherit', 'inherit'] }
      );
      if (verifyResult.exitCode !== 0) {
        throw new Error(
          `Android .so verification failed with exit code ${verifyResult.exitCode}`
        );
      }
    } else {
      console.log(
        'ℹ️  Not in GitHub CI, skipping version resolution and package.json modification'
      );
      if (shouldSkipNativeBuild()) {
        console.log('ℹ️  --skip flag detected, skipping native artifacts build');
      } else {
        await buildNativeArtifacts();
      }
    }

    console.log('✅ Prepublish script completed successfully');
  } catch (error) {
    console.error('❌ Prepublish script failed:', error);
    process.exit(1);
  }
}

main();
