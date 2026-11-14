/**
 * [INPUT]: 依赖文件系统、项目路径、workspace 结构与本地化文案
 * [OUTPUT]: 对外提供 checkLockFiles，检查项目包管理器锁文件并给出一致性提示
 * [POS]: CLI 构建前环境检查层，只报告锁文件状态，不修改依赖解析结果
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import fs from 'fs';
import path from 'path';
import { t } from './i18n';

const lockFiles = [
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'bun.lock',
];

// Function to check if a directory is a monorepo root
// (package.json workspaces field, or pnpm-workspace.yaml)
function hasWorkspaces(dir: string): boolean {
  if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
    return true;
  }
  const pkgPath = path.join(dir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      return !!pkg.workspaces;
    } catch (_e) {
      // Ignore parsing errors
    }
  }
  return false;
}

// Helper function to find lock files in a specific directory
function findLockFilesInDir(directory: string): string[] {
  const found: string[] = [];
  for (const file of lockFiles) {
    const filePath = path.join(directory, file);
    if (fs.existsSync(filePath)) {
      found.push(filePath);
    }
  }
  return found;
}

export function checkLockFiles() {
  const cwd = process.cwd();
  let searchDir = cwd;
  let foundLockFiles = findLockFilesInDir(searchDir);

  // If no lock file in cwd, try to find monorepo root and check there
  if (foundLockFiles.length === 0) {
    // Search upwards for package.json with workspaces
    let currentDir = path.dirname(cwd); // Start searching from parent
    let projectRootDir: string | null = null;

    while (true) {
      if (hasWorkspaces(currentDir)) {
        projectRootDir = currentDir;
        break;
      }
      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) {
        // Reached the filesystem root
        break;
      }
      currentDir = parentDir;
    }

    // If a potential root was found, switch search directory and re-check
    if (projectRootDir) {
      searchDir = projectRootDir;
      foundLockFiles = findLockFilesInDir(searchDir);
    }
    // If no projectRootDir found, foundLockFiles remains empty and searchDir remains cwd
  }

  // Handle results based on findings in the final searchDir
  if (foundLockFiles.length === 1) {
    // Successfully found one lock file in the determined searchDir
    return;
  }

  if (foundLockFiles.length > 1) {
    // Found multiple lock files in the determined searchDir
    console.warn(t('lockBestPractice'));
    throw new Error(
      t('multipleLocksFound', { lockFiles: foundLockFiles.join(', ') }),
    );
  }

  // If we reach here, foundLockFiles.length === 0
  console.warn(t('lockBestPractice'));
  // Warn instead of throwing an error if no lock file is found
  console.warn(t('lockNotFound'));
}
