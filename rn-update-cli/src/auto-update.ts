/**
 * [INPUT]: 依赖 Node 子进程、文件系统、fs-helpers 缓存目录、options 环境开关与 runtime 包管理器类型
 * [OUTPUT]: 对外提供 PackageManager、AutoUpdateNotice、全局包管理器探测及后台更新编排
 * [POS]: CLI 后台自更新边界，负责包管理器归属、锁与失败重试，不参与前台命令分发
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { spawn } from 'child_process';
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import path from 'path';
import { userCacheDir } from './utils/fs-helpers';
import { isTruthyEnv } from './utils/options';
import type { PackageManager } from './utils/runtime';

export type { PackageManager } from './utils/runtime';

interface AutoUpdateCandidate {
  currentVersion: string;
  targetVersion: string;
  packageRoot: string;
  packageManager: PackageManager;
  registryUrl: string;
  installPrefix?: string;
}

interface AutoUpdateState extends AutoUpdateCandidate {
  status: 'running' | 'updated' | 'failed';
  attemptedAt: number;
  finishedAt?: number;
  retryAt?: number;
  failureCount?: number;
  failureKind?: 'network' | 'permission' | 'package-manager' | 'unknown';
  message?: string;
  reportedAt?: number;
}

export interface AutoUpdateNotice {
  kind: 'updated' | 'permission';
  currentVersion: string;
  targetVersion: string;
  command?: string;
}

interface PackageManagerDetectionOptions {
  packageRoot: string;
  env?: NodeJS.ProcessEnv;
  npmGlobalDir?: string;
  yarnGlobalDir?: string;
}

const PACKAGE_NAME = 'rn-update-cli';
const WORKER_ENV = 'RNU_AUTO_UPDATE_WORKER';
const CANDIDATE_ENV = 'RNU_AUTO_UPDATE_CANDIDATE';
const LOCK_STALE_MS = 10 * 60 * 1000;
const UPDATE_TIMEOUT_MS = 2 * 60 * 1000;
const NETWORK_RETRY_MS = 6 * 60 * 60 * 1000;
const FAILURE_RETRY_MS = 24 * 60 * 60 * 1000;
const PERMISSION_RETRY_MS = 7 * 24 * 60 * 60 * 1000;
const OUTPUT_LIMIT = 32 * 1024;

function cacheDir(): string {
  return userCacheDir(PACKAGE_NAME);
}

function stateFile(): string {
  return path.join(cacheDir(), 'auto-update.json');
}

function lockDir(): string {
  return path.join(cacheDir(), 'auto-update.lock');
}

function readState(): AutoUpdateState | undefined {
  try {
    const parsed = JSON.parse(readFileSync(stateFile(), 'utf8'));
    if (
      !parsed ||
      !['running', 'updated', 'failed'].includes(parsed.status) ||
      typeof parsed.targetVersion !== 'string' ||
      typeof parsed.attemptedAt !== 'number'
    ) {
      return undefined;
    }
    return parsed as AutoUpdateState;
  } catch {
    return undefined;
  }
}

function writeState(state: AutoUpdateState): void {
  try {
    mkdirSync(cacheDir(), { recursive: true });
    const temporary = `${stateFile()}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(state));
    renameSync(temporary, stateFile());
  } catch {
    // A read-only cache must never interfere with the CLI or the update.
  }
}

function normalizePath(value: string): string {
  let resolved = path.resolve(value);
  try {
    resolved = realpathSync.native(resolved);
  } catch {
    // The caller may supply a path that was replaced during an update.
  }
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isWithin(child: string, parent: string): boolean {
  const relative = path.relative(normalizePath(parent), normalizePath(child));
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

function managerFromUserAgent(
  env: NodeJS.ProcessEnv,
): PackageManager | undefined {
  const value =
    `${env.npm_config_user_agent ?? ''} ${env.npm_execpath ?? ''}`.toLowerCase();
  if (/\bbun(?:\/|\s|$)/.test(value)) return 'bun';
  if (/\bpnpm(?:\/|\s|$)/.test(value)) return 'pnpm';
  if (/\byarn(?:\/|\s|$)/.test(value)) return 'yarn';
  if (/\bnpm(?:\/|\s|$)/.test(value)) return 'npm';
  return undefined;
}

function parseManager(value: string | undefined): PackageManager | undefined {
  const manager = value?.trim().toLowerCase();
  return manager === 'npm' ||
    manager === 'pnpm' ||
    manager === 'yarn' ||
    manager === 'bun'
    ? manager
    : undefined;
}

/**
 * Identify the package manager that owns this global installation. Project
 * lockfiles are deliberately ignored: they say how the app is installed, not
 * how this CLI was installed.
 */
export function detectGlobalPackageManager({
  packageRoot,
  env = process.env,
  npmGlobalDir,
  yarnGlobalDir,
}: PackageManagerDetectionOptions): PackageManager | undefined {
  const root = normalizePath(packageRoot);
  const normalized = root.replaceAll('\\', '/').toLowerCase();

  if (yarnGlobalDir && isWithin(root, yarnGlobalDir)) return 'yarn';
  if (npmGlobalDir && isWithin(root, npmGlobalDir)) return 'npm';
  if (/\/(?:\.bun|bun)\/install\/global\/node_modules\//.test(normalized)) {
    return 'bun';
  }
  if (/\/pnpm\/global\/[^/]+\//.test(normalized)) return 'pnpm';
  if (
    /\/(?:\.config\/yarn\/global|yarn\/data\/global)\/node_modules\//.test(
      normalized,
    )
  ) {
    return 'yarn';
  }

  // Custom npm prefixes conventionally use <prefix>/lib/node_modules on
  // Unix and <prefix>/node_modules on Windows. Only accept the generic form
  // when the package is outside the current project, so npx and local installs
  // are never self-modified.
  const cwdNodeModules = path.join(
    normalizePath(process.cwd()),
    'node_modules',
  );
  const configuredPrefixModules = env.npm_config_prefix
    ? path.join(normalizePath(env.npm_config_prefix), 'node_modules')
    : undefined;
  const looksGlobal =
    normalized.includes('/lib/node_modules/') ||
    (process.platform === 'win32' &&
      (normalized.includes('/npm/node_modules/') ||
        (configuredPrefixModules && isWithin(root, configuredPrefixModules))));
  if (looksGlobal && !isWithin(root, cwdNodeModules)) {
    return (
      parseManager(env.RNU_AUTO_UPDATE_PACKAGE_MANAGER) ??
      managerFromUserAgent(env) ??
      'npm'
    );
  }
  return undefined;
}

function globalDirectories(): {
  npmGlobalDir?: string;
  npmPrefix?: string;
  yarnGlobalDir?: string;
} {
  try {
    const dirs = require('global-dirs') as typeof import('global-dirs');
    return {
      npmGlobalDir: dirs.npm?.packages,
      npmPrefix: dirs.npm?.prefix,
      yarnGlobalDir: dirs.yarn?.packages,
    };
  } catch {
    return {};
  }
}

function sanitizeRegistryUrl(value: string): string {
  try {
    const registry = new URL(value);
    if (registry.protocol !== 'http:' && registry.protocol !== 'https:') {
      return 'https://registry.npmjs.org/';
    }
    // Credentials belong in the user's package-manager configuration, not in
    // a process argument or our state file.
    registry.username = '';
    registry.password = '';
    return registry.toString();
  } catch {
    return 'https://registry.npmjs.org/';
  }
}

export function buildUpdateCommand(
  manager: PackageManager,
  targetVersion: string,
  registryUrl: string,
  installPrefix?: string,
): { command: string; args: string[] } {
  const target = `${PACKAGE_NAME}@${targetVersion}`;
  const registry = sanitizeRegistryUrl(registryUrl);
  // Windows package managers are .cmd shims and therefore run through
  // cmd.exe. Keep the URL out of that command line (it may contain shell
  // metacharacters); runPackageManager supplies the same value through the
  // environment instead.
  const registryArgs =
    process.platform === 'win32' ? [] : [`--registry=${registry}`];
  switch (manager) {
    case 'pnpm':
      return {
        command: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
        args: ['add', '--global', target, '--reporter=silent', ...registryArgs],
      };
    case 'yarn':
      return {
        command: process.platform === 'win32' ? 'yarn.cmd' : 'yarn',
        args: [
          'global',
          'add',
          target,
          '--non-interactive',
          '--silent',
          ...registryArgs,
        ],
      };
    case 'bun':
      return {
        command: process.platform === 'win32' ? 'bun.exe' : 'bun',
        args: ['add', '--global', target, '--no-progress', ...registryArgs],
      };
    default:
      return {
        command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
        args: [
          'install',
          '--global',
          target,
          ...(installPrefix && process.platform !== 'win32'
            ? [`--prefix=${installPrefix}`]
            : []),
          '--no-audit',
          '--no-fund',
          '--loglevel=error',
          ...registryArgs,
        ],
      };
  }
}

function inferNpmPrefix(
  packageRoot: string,
  npmGlobalDir?: string,
  npmPrefix?: string,
): string | undefined {
  if (npmGlobalDir && npmPrefix && isWithin(packageRoot, npmGlobalDir)) {
    return normalizePath(npmPrefix);
  }
  const modules = path.dirname(normalizePath(packageRoot));
  if (path.basename(modules).toLowerCase() !== 'node_modules') {
    return undefined;
  }
  const modulesParent = path.dirname(modules);
  return path.basename(modulesParent).toLowerCase() === 'lib'
    ? path.dirname(modulesParent)
    : modulesParent;
}

function isDisabled(env: NodeJS.ProcessEnv): boolean {
  const disabled = (value: string | undefined) =>
    value === '0' || value?.toLowerCase() === 'false';
  return (
    disabled(env.RNU_AUTO_UPDATE) ||
    isTruthyEnv(env.RNU_DISABLE_AUTO_UPDATE) ||
    isTruthyEnv(env.NO_UPDATE_NOTIFIER) ||
    isTruthyEnv(env.CI)
  );
}

function shouldRetry(
  state: AutoUpdateState | undefined,
  target: string,
): boolean {
  if (!state || state.targetVersion !== target) return true;
  if (state.status === 'updated') return false;
  if (state.status === 'running') {
    return Date.now() - state.attemptedAt >= LOCK_STALE_MS;
  }
  return !state.retryAt || state.retryAt <= Date.now();
}

/**
 * Start a detached updater after the foreground command has completed. This
 * function is synchronous on purpose: it is safe to call from process.exit.
 */
export function launchAutoUpdate(
  currentVersion: string,
  targetVersion: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (
    !targetVersion ||
    targetVersion === currentVersion ||
    isDisabled(env) ||
    !shouldRetry(readState(), targetVersion)
  ) {
    return false;
  }

  const packageRoot = path.resolve(__dirname, '..');
  const directories = globalDirectories();
  const detected = detectGlobalPackageManager({
    packageRoot,
    env,
    npmGlobalDir: directories.npmGlobalDir,
    yarnGlobalDir: directories.yarnGlobalDir,
  });
  if (!detected) return false;
  const packageManager =
    parseManager(env.RNU_AUTO_UPDATE_PACKAGE_MANAGER) ?? detected;

  let registryUrl = 'https://registry.npmjs.org/';
  try {
    const registryModule = require('registry-auth-token/registry-url');
    const getRegistryUrl = (registryModule.default ?? registryModule) as (
      scope?: string,
    ) => string;
    registryUrl = getRegistryUrl('');
  } catch {
    // Keep the public npm registry fallback when config parsing fails.
  }
  const candidate: AutoUpdateCandidate = {
    currentVersion,
    targetVersion,
    packageRoot: normalizePath(packageRoot),
    packageManager,
    registryUrl: sanitizeRegistryUrl(registryUrl),
    installPrefix:
      packageManager === 'npm' && detected === 'npm'
        ? inferNpmPrefix(
            packageRoot,
            directories.npmGlobalDir,
            directories.npmPrefix,
          )
        : undefined,
  };

  try {
    const worker = spawn(process.execPath, [__filename], {
      detached: true,
      env: {
        ...env,
        [WORKER_ENV]: '1',
        [CANDIDATE_ENV]: JSON.stringify(candidate),
      },
      stdio: 'ignore',
      windowsHide: true,
    });
    worker.once('error', () => {});
    worker.unref();
    return true;
  } catch {
    return false;
  }
}

function acquireLock(): boolean {
  try {
    mkdirSync(cacheDir(), { recursive: true });
    try {
      mkdirSync(lockDir());
      return true;
    } catch {
      if (
        existsSync(lockDir()) &&
        Date.now() - statSync(lockDir()).mtimeMs >= LOCK_STALE_MS
      ) {
        rmSync(lockDir(), { force: true, recursive: true });
        mkdirSync(lockDir());
        return true;
      }
      return false;
    }
  } catch {
    return false;
  }
}

function appendBounded(current: string, chunk: Buffer | string): string {
  const combined = `${current}${chunk.toString()}`;
  return combined.length > OUTPUT_LIMIT
    ? combined.slice(combined.length - OUTPUT_LIMIT)
    : combined;
}

function classifyFailure(
  error: string,
): NonNullable<AutoUpdateState['failureKind']> {
  if (/eacces|eperm|permission denied|access is denied/i.test(error)) {
    return 'permission';
  }
  if (
    /econn|enet|eai_again|enotfound|timed?\s*out|timeout|certificate|socket|network|fetch/i.test(
      error,
    )
  ) {
    return 'network';
  }
  if (/enoent|not recognized|command not found/i.test(error)) {
    return 'package-manager';
  }
  return 'unknown';
}

function retryDelay(kind: NonNullable<AutoUpdateState['failureKind']>): number {
  if (kind === 'permission') return PERMISSION_RETRY_MS;
  if (kind === 'network') return NETWORK_RETRY_MS;
  return FAILURE_RETRY_MS;
}

function compactMessage(value: string): string {
  return value
    .split(String.fromCharCode(27))
    .map((part, index) =>
      index === 0 ? part : part.replace(/^\[[0-9;]*m/, ''),
    )
    .join('')
    .trim()
    .slice(-2000);
}

async function runPackageManager(
  command: string,
  args: string[],
  registryUrl: string,
  installPrefix?: string,
): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    let output = '';
    let settled = false;
    const child = spawn(command, args, {
      env: {
        ...process.env,
        npm_config_audit: 'false',
        npm_config_fund: 'false',
        ...(installPrefix
          ? {
              NPM_CONFIG_PREFIX: installPrefix,
              npm_config_prefix: installPrefix,
            }
          : {}),
        npm_config_registry: sanitizeRegistryUrl(registryUrl),
        npm_config_update_notifier: 'false',
      },
      shell: process.platform === 'win32' && command.endsWith('.cmd'),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const finish = (code: number, extra = '') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, output: appendBounded(output, extra) });
    };
    child.stdout?.on('data', (chunk) => {
      output = appendBounded(output, chunk);
    });
    child.stderr?.on('data', (chunk) => {
      output = appendBounded(output, chunk);
    });
    child.once('error', (error) => finish(127, error.message));
    child.once('close', (code, signal) =>
      finish(code ?? 1, signal ? `\nTerminated by ${signal}` : ''),
    );
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(124, '\nUpdate timed out');
    }, UPDATE_TIMEOUT_MS);
  });
}

async function runWorker(candidate: AutoUpdateCandidate): Promise<void> {
  if (!acquireLock()) return;
  const previous = readState();
  const running: AutoUpdateState = {
    ...candidate,
    status: 'running',
    attemptedAt: Date.now(),
    failureCount:
      previous?.targetVersion === candidate.targetVersion
        ? (previous.failureCount ?? 0) + 1
        : 1,
  };
  writeState(running);

  try {
    if (process.platform !== 'win32') {
      accessSync(path.dirname(candidate.packageRoot), constants.W_OK);
    }
  } catch (error) {
    const failureKind = 'permission' as const;
    writeState({
      ...running,
      status: 'failed',
      finishedAt: Date.now(),
      retryAt: Date.now() + retryDelay(failureKind),
      failureKind,
      message: compactMessage(String(error)),
    });
    rmSync(lockDir(), { force: true, recursive: true });
    return;
  }

  const update = buildUpdateCommand(
    candidate.packageManager,
    candidate.targetVersion,
    candidate.registryUrl,
    candidate.installPrefix,
  );
  const result = await runPackageManager(
    update.command,
    update.args,
    candidate.registryUrl,
    candidate.installPrefix,
  );
  if (result.code === 0) {
    writeState({
      ...running,
      status: 'updated',
      finishedAt: Date.now(),
      message: undefined,
    });
  } else {
    const detail = compactMessage(result.output);
    const failureKind = classifyFailure(detail);
    writeState({
      ...running,
      status: 'failed',
      finishedAt: Date.now(),
      retryAt: Date.now() + retryDelay(failureKind),
      failureKind,
      message: detail,
    });
  }
  rmSync(lockDir(), { force: true, recursive: true });
}

export function consumeAutoUpdateNotice(
  currentVersion: string,
): AutoUpdateNotice | undefined {
  const state = readState();
  if (!state || state.reportedAt) return undefined;
  if (state.status === 'updated' && currentVersion === state.targetVersion) {
    writeState({ ...state, reportedAt: Date.now() });
    return {
      kind: 'updated',
      currentVersion: state.currentVersion,
      targetVersion: state.targetVersion,
    };
  }
  if (state.status === 'failed' && state.failureKind === 'permission') {
    writeState({ ...state, reportedAt: Date.now() });
    const update = buildUpdateCommand(
      state.packageManager,
      state.targetVersion,
      state.registryUrl,
      state.installPrefix,
    );
    return {
      kind: 'permission',
      currentVersion,
      targetVersion: state.targetVersion,
      command: [update.command, ...update.args].join(' '),
    };
  }
  return undefined;
}

if (process.env[WORKER_ENV] === '1') {
  try {
    const candidate = JSON.parse(
      process.env[CANDIDATE_ENV] ?? '',
    ) as AutoUpdateCandidate;
    if (
      candidate?.packageRoot &&
      candidate.targetVersion &&
      parseManager(candidate.packageManager)
    ) {
      void runWorker(candidate).catch(() => {
        rmSync(lockDir(), { force: true, recursive: true });
      });
    }
  } catch {
    // Malformed worker input is ignored; foreground CLI operation is over.
  }
}
