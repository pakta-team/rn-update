/**
 * [INPUT]: 依赖 fs-helpers 原语、Node 文件系统与每例独立临时目录
 * [OUTPUT]: 验证目录创建/清空、存在性、删除、移动覆盖及读取失败透传
 * [POS]: CLI 轻量文件系统回归，锁定替代 fs-extra 后的实际磁盘语义
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  emptyDirSync,
  ensureDir,
  ensureDirSync,
  moveSync,
  pathExists,
  remove,
  removeSync,
} from '../src/utils/fs-helpers';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rnu-fs-helpers-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('fs-helpers', () => {
  test('remove and removeSync delete trees and ignore missing paths', async () => {
    ensureDirSync(path.join(dir, 'a/b'));
    fs.writeFileSync(path.join(dir, 'a/b/c.txt'), 'c');
    await remove(path.join(dir, 'a'));
    expect(fs.existsSync(path.join(dir, 'a'))).toBe(false);
    await remove(path.join(dir, 'missing'));
    removeSync(path.join(dir, 'missing'));
  });

  test('ensureDir creates nested directories and tolerates existing ones', async () => {
    const nested = path.join(dir, 'x/y/z');
    await ensureDir(nested);
    await ensureDir(nested);
    ensureDirSync(nested);
    expect(fs.statSync(nested).isDirectory()).toBe(true);
  });

  test('pathExists', async () => {
    expect(await pathExists(dir)).toBe(true);
    expect(await pathExists(path.join(dir, 'missing'))).toBe(false);
  });

  test('emptyDirSync clears a directory and creates a missing one', () => {
    ensureDirSync(path.join(dir, 'out/sub'));
    fs.writeFileSync(path.join(dir, 'out/file.js'), 'x');
    fs.writeFileSync(path.join(dir, 'out/sub/file.map'), 'x');
    emptyDirSync(path.join(dir, 'out'));
    expect(fs.readdirSync(path.join(dir, 'out'))).toEqual([]);

    emptyDirSync(path.join(dir, 'new/deep'));
    expect(fs.readdirSync(path.join(dir, 'new/deep'))).toEqual([]);
  });

  test('emptyDirSync rethrows when an existing directory cannot be read', () => {
    // Windows 忽略目录的 POSIX 权限位，chmod 000 仍可读取，无法构造该失败场景
    if (process.platform === 'win32') return;
    const locked = path.join(dir, 'locked');
    ensureDirSync(locked);
    fs.writeFileSync(path.join(locked, 'stale.js'), 'x');
    fs.chmodSync(locked, 0o000);
    try {
      // root reads anything: nothing to assert there
      if (process.getuid?.() === 0) return;
      expect(() => emptyDirSync(locked)).toThrow();
    } finally {
      fs.chmodSync(locked, 0o755);
    }
    expect(fs.readdirSync(locked)).toEqual(['stale.js']);
  });

  test('moveSync replaces the destination and creates its parent', () => {
    fs.writeFileSync(path.join(dir, 'src.js'), 'new');
    moveSync(path.join(dir, 'src.js'), path.join(dir, 'a/b/dest.js'));
    expect(fs.readFileSync(path.join(dir, 'a/b/dest.js'), 'utf8')).toBe('new');
    expect(fs.existsSync(path.join(dir, 'src.js'))).toBe(false);

    fs.writeFileSync(path.join(dir, 'src.js'), 'newer');
    moveSync(path.join(dir, 'src.js'), path.join(dir, 'a/b/dest.js'));
    expect(fs.readFileSync(path.join(dir, 'a/b/dest.js'), 'utf8')).toBe(
      'newer',
    );
  });
});
