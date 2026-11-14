/**
 * [INPUT]: 依赖 node:fs/os/path 与平台缓存目录约定
 * [OUTPUT]: 对外提供 userCacheDir、remove/removeSync、ensureDir/ensureDirSync、pathExists、emptyDirSync、moveSync
 * [POS]: CLI 轻量文件系统原语层，替代 fs-extra 的子集能力，供缓存、打包与插件探测共用
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

// The handful of fs-extra conveniences the CLI used, on plain node:fs.

import fs from 'fs';
import { homedir } from 'os';
import path from 'path';

/**
 * The per-user cache directory for `name`: $XDG_CACHE_HOME when set (on every
 * platform; also lets tests isolate), else the platform's cache location.
 */
export function userCacheDir(name: string): string {
  if (process.env.XDG_CACHE_HOME) {
    return path.join(process.env.XDG_CACHE_HOME, name);
  }
  switch (process.platform) {
    case 'darwin':
      return path.join(homedir(), 'Library', 'Caches', name);
    case 'win32':
      return path.join(
        process.env.LOCALAPPDATA ?? path.join(homedir(), 'AppData', 'Local'),
        name,
        'Cache',
      );
    default:
      return path.join(homedir(), '.cache', name);
  }
}

/** `rm -rf`: no error when the path is already gone. */
export function remove(target: string): Promise<void> {
  return fs.promises.rm(target, { recursive: true, force: true });
}

export function removeSync(target: string): void {
  fs.rmSync(target, { recursive: true, force: true });
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true });
}

export function ensureDirSync(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function pathExists(target: string): Promise<boolean> {
  return fs.promises.access(target).then(
    () => true,
    () => false,
  );
}

/** Deletes everything inside `dir`, creating it when missing. */
export function emptyDirSync(dir: string): void {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    // only a missing directory is created; an unreadable one must not pass
    // for emptied
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    ensureDirSync(dir);
    return;
  }
  for (const name of names) removeSync(path.join(dir, name));
}

/**
 * Moves `src` to `dest`, replacing it. Creates the parent of `dest`, and
 * falls back to copy + delete when the two are on different devices.
 */
export function moveSync(src: string, dest: string): void {
  ensureDirSync(path.dirname(dest));
  try {
    fs.renameSync(src, dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    removeSync(dest);
    fs.cpSync(src, dest, { recursive: true });
    removeSync(src);
  }
}
