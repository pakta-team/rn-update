import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { checkLockFiles } from '../src/utils/check-lockfile';

const originalCwd = process.cwd();

function mkTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

describe('utils/check-lockfile', () => {
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = mkTempDir('rn-update-lockfile-');
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('passes when exactly one lock file exists in current directory', () => {
    process.chdir(tempRoot);
    fs.writeFileSync(path.join(tempRoot, 'bun.lock'), '');

    expect(() => checkLockFiles()).not.toThrow();
  });

  test('throws when multiple lock files exist in current directory', () => {
    process.chdir(tempRoot);
    fs.writeFileSync(path.join(tempRoot, 'bun.lock'), '');
    fs.writeFileSync(path.join(tempRoot, 'yarn.lock'), '');

    expect(() => checkLockFiles()).toThrow();
  });

  test('detects lock file from monorepo root when cwd has none', () => {
    const monorepoRoot = path.join(tempRoot, 'repo');
    const packageDir = path.join(monorepoRoot, 'packages', 'cli');
    fs.mkdirSync(packageDir, { recursive: true });
    writeJson(path.join(monorepoRoot, 'package.json'), {
      private: true,
      workspaces: ['packages/*'],
    });
    fs.writeFileSync(path.join(monorepoRoot, 'pnpm-lock.yaml'), '');

    process.chdir(packageDir);
    expect(() => checkLockFiles()).not.toThrow();
  });

  test('warns but does not throw when no lock file is found', () => {
    process.chdir(tempRoot);
    writeJson(path.join(tempRoot, 'package.json'), { name: 'no-lock' });

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((item) => String(item)).join(' '));
    };

    try {
      expect(() => checkLockFiles()).not.toThrow();
      expect(warnings.length).toBeGreaterThan(0);
    } finally {
      console.warn = originalWarn;
    }
  });
});
