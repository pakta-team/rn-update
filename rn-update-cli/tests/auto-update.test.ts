import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawn } from 'child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  buildUpdateCommand,
  consumeAutoUpdateNotice,
  detectGlobalPackageManager,
} from '../src/auto-update';

describe('auto update package-manager detection', () => {
  test('uses the global installation owner instead of the project lockfile', () => {
    expect(
      detectGlobalPackageManager({
        packageRoot: '/prefix/npm/lib/node_modules/rn-update-cli',
        npmGlobalDir: '/prefix/npm/lib/node_modules',
        yarnGlobalDir: '/prefix/yarn/node_modules',
        env: { npm_config_user_agent: 'yarn/1.22.22' },
      }),
    ).toBe('npm');

    expect(
      detectGlobalPackageManager({
        packageRoot: '/prefix/yarn/node_modules/rn-update-cli',
        npmGlobalDir: '/prefix/npm/lib/node_modules',
        yarnGlobalDir: '/prefix/yarn/node_modules',
      }),
    ).toBe('yarn');
  });

  test('recognizes pnpm and bun global layouts', () => {
    expect(
      detectGlobalPackageManager({
        packageRoot:
          '/home/me/.local/share/pnpm/global/5/.pnpm/rn-update-cli@3.0.0/node_modules/rn-update-cli',
      }),
    ).toBe('pnpm');
    expect(
      detectGlobalPackageManager({
        packageRoot: '/home/me/.bun/install/global/node_modules/rn-update-cli',
      }),
    ).toBe('bun');
  });

  test('never treats a project dependency as a global CLI', () => {
    expect(
      detectGlobalPackageManager({
        packageRoot: path.join(process.cwd(), 'node_modules/rn-update-cli'),
        env: { npm_config_user_agent: 'pnpm/10.0.0' },
      }),
    ).toBeUndefined();
  });

  test('defaults custom Unix global prefixes to npm', () => {
    expect(
      detectGlobalPackageManager({
        packageRoot: '/custom/prefix/lib/node_modules/rn-update-cli',
        env: {},
      }),
    ).toBe('npm');
  });
});

describe('auto update commands', () => {
  test('builds non-interactive global commands for every supported manager', () => {
    const registry = 'https://registry.example.test/npm/';
    expect(buildUpdateCommand('npm', '3.0.0', registry)).toEqual({
      command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
      args: [
        'install',
        '--global',
        'rn-update-cli@3.0.0',
        '--no-audit',
        '--no-fund',
        '--loglevel=error',
        ...(process.platform === 'win32' ? [] : [`--registry=${registry}`]),
      ],
    });
    expect(buildUpdateCommand('pnpm', '3.0.0', registry).args).toContain(
      '--global',
    );
    expect(
      buildUpdateCommand('yarn', '3.0.0', registry).args.slice(0, 2),
    ).toEqual(['global', 'add']);
    expect(buildUpdateCommand('bun', '3.0.0', registry).args).toContain(
      '--global',
    );
  });

  test('worker runs the package manager and persists success', async () => {
    if (process.platform === 'win32') return;
    const root = mkdtempSync(path.join(tmpdir(), 'rnu-auto-worker-'));
    try {
      const packageRoot = path.join(
        root,
        'prefix/lib/node_modules/rn-update-cli',
      );
      const binDir = path.join(root, 'bin');
      const cacheHome = path.join(root, 'cache');
      const argsFile = path.join(root, 'npm-args.txt');
      mkdirSync(packageRoot, { recursive: true });
      mkdirSync(binDir, { recursive: true });
      const npm = path.join(binDir, 'npm');
      writeFileSync(npm, '#!/bin/sh\nprintf "%s\\n" "$@" > "$RNU_TEST_ARGS"\n');
      chmodSync(npm, 0o755);

      const candidate = {
        currentVersion: '1.0.0',
        targetVersion: '1.0.1',
        packageRoot,
        packageManager: 'npm',
        registryUrl: 'https://registry.example.test/npm/',
        installPrefix: path.join(root, 'prefix'),
      };
      const status = await new Promise<number | null>((resolve, reject) => {
        const worker = spawn(process.execPath, ['src/auto-update.ts'], {
          cwd: path.join(import.meta.dir, '..'),
          env: {
            ...process.env,
            PATH: `${binDir}:${process.env.PATH ?? ''}`,
            RNU_AUTO_UPDATE_WORKER: '1',
            RNU_AUTO_UPDATE_CANDIDATE: JSON.stringify(candidate),
            RNU_TEST_ARGS: argsFile,
            XDG_CACHE_HOME: cacheHome,
          },
          stdio: 'ignore',
        });
        worker.once('error', reject);
        worker.once('close', resolve);
      });

      expect(status).toBe(0);
      expect(readFileSync(argsFile, 'utf8')).toContain('rn-update-cli@1.0.1');
      expect(readFileSync(argsFile, 'utf8')).toContain(
        '--registry=https://registry.example.test/npm/',
      );
      expect(readFileSync(argsFile, 'utf8')).toContain(
        `--prefix=${path.join(root, 'prefix')}`,
      );
      expect(
        JSON.parse(
          readFileSync(
            path.join(cacheHome, 'rn-update-cli/auto-update.json'),
            'utf8',
          ),
        ).status,
      ).toBe('updated');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('does not expose registry credentials in process arguments', () => {
    const command = buildUpdateCommand(
      'npm',
      '3.0.0',
      'https://user:secret@registry.example.test/npm/',
    );
    expect(command.args.join(' ')).not.toContain('user');
    expect(command.args.join(' ')).not.toContain('secret');
    if (process.platform === 'win32') {
      expect(command.args).not.toContain(
        '--registry=https://registry.example.test/npm/',
      );
    } else {
      expect(command.args).toContain(
        '--registry=https://registry.example.test/npm/',
      );
    }
  });

  test('keeps npm updates in the prefix that owns the running CLI', () => {
    const command = buildUpdateCommand(
      'npm',
      '3.0.0',
      'https://registry.npmjs.org/',
      '/custom/prefix',
    );
    if (process.platform === 'win32') {
      expect(command.args).not.toContain('--prefix=/custom/prefix');
    } else {
      expect(command.args).toContain('--prefix=/custom/prefix');
    }
  });
});

describe('auto update notices', () => {
  let cacheHome: string;
  let previousCacheHome: string | undefined;

  beforeEach(() => {
    previousCacheHome = process.env.XDG_CACHE_HOME;
    cacheHome = mkdtempSync(path.join(tmpdir(), 'rnu-auto-update-'));
    process.env.XDG_CACHE_HOME = cacheHome;
  });

  afterEach(() => {
    if (previousCacheHome === undefined) {
      delete process.env.XDG_CACHE_HOME;
    } else {
      process.env.XDG_CACHE_HOME = previousCacheHome;
    }
    rmSync(cacheHome, { force: true, recursive: true });
  });

  function writeState(state: Record<string, unknown>) {
    const dir = path.join(cacheHome, 'rn-update-cli');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'auto-update.json'), JSON.stringify(state));
  }

  test('reports a completed background update exactly once', () => {
    writeState({
      status: 'updated',
      attemptedAt: Date.now(),
      currentVersion: '1.0.0',
      targetVersion: '1.0.1',
      packageRoot: '/global/rn-update-cli',
      packageManager: 'npm',
      registryUrl: 'https://registry.npmjs.org/',
    });

    expect(consumeAutoUpdateNotice('1.0.1')).toEqual({
      kind: 'updated',
      currentVersion: '1.0.0',
      targetVersion: '1.0.1',
    });
    expect(consumeAutoUpdateNotice('1.0.1')).toBeUndefined();
  });

  test('turns a permission failure into a manual manager-specific command', () => {
    writeState({
      status: 'failed',
      attemptedAt: Date.now(),
      currentVersion: '1.0.0',
      targetVersion: '1.0.1',
      packageRoot: '/global/rn-update-cli',
      packageManager: 'pnpm',
      registryUrl: 'https://registry.example.test/',
      failureKind: 'permission',
    });

    expect(consumeAutoUpdateNotice('1.0.0')).toEqual({
      kind: 'permission',
      currentVersion: '1.0.0',
      targetVersion: '1.0.1',
      command: expect.stringContaining(
        `${process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'} add --global rn-update-cli@1.0.1`,
      ),
    });
  });
});
