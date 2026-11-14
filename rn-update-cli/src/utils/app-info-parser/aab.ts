/**
 * [INPUT]: 依赖 AAB ZIP 读取、Android manifest/resource 解析、文件系统与外部包工具
 * [OUTPUT]: 对外提供 AabParser，提取 Android App Bundle 的版本和资源元数据
 * [POS]: 应用包解析子域的 AAB 实现，与 ApkParser 共享基础 ZIP/资源解析协议
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathExists, remove } from '../fs-helpers';
import { t } from '../i18n';
import { extractFirstEntry } from '../zip-entries';

/** Build a universal APK from an .aab with bundletool (or npx node-bundletool). */
export async function extractApk(
  aabPath: string,
  outputPath: string,
  {
    includeAllSplits,
    splits,
  }: { includeAllSplits?: boolean; splits?: string[] | null },
) {
  const bundlePath = path.resolve(aabPath);
  const normalizedSplits = Array.isArray(splits)
    ? splits.map((item) => item.trim()).filter(Boolean)
    : [];
  const modules = includeAllSplits
    ? null
    : Array.from(new Set(['base', ...normalizedSplits]));
  const modulesArgs = modules ? [`--modules=${modules.join(',')}`] : [];

  const runCommand = (
    command: string,
    args: string[],
    options: { stdio?: 'inherit'; env?: NodeJS.ProcessEnv } = {},
  ) =>
    new Promise<void>((resolve, reject) => {
      const inheritStdio = options.stdio === 'inherit';
      const child = spawn(command, args, {
        stdio: inheritStdio ? 'inherit' : ['ignore', 'pipe', 'pipe'],
        env: options.env,
      });
      let stderr = '';
      if (!inheritStdio) {
        child.stderr?.on('data', (chunk) => {
          stderr += chunk.toString();
        });
      }
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(
          new Error(
            stderr.trim() || `Command failed: ${command} (code ${code})`,
          ),
        );
      });
    });

  // Create a temp file for the .apks output
  const tempDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'bundletool-'),
  );
  const tempApksPath = path.join(tempDir, 'output.apks');

  const needsNpxDownload = async () => {
    try {
      await runCommand('npx', ['--no-install', 'node-bundletool', '--version']);
      return false;
    } catch {
      return true;
    }
  };

  try {
    // 1. Build APKS (universal mode)
    // We assume bundletool is in the path.
    // User might need keystore to sign it properly but for simple extraction we stick to default debug key if possible or unsigned?
    // actually bundletool build-apks signs with debug key by default if no keystore provided.

    try {
      await runCommand('bundletool', [
        'build-apks',
        '--mode=universal',
        `--bundle=${bundlePath}`,
        `--output=${tempApksPath}`,
        '--overwrite',
        ...modulesArgs,
      ]);
    } catch (e) {
      // Only fall back when bundletool itself is missing from PATH (spawn
      // ENOENT). Any other failure (corrupt AAB, Java issues, bad args,
      // non-zero exit) must surface as-is instead of being masked by an
      // online npx install.
      if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        throw e;
      }
      // Fallback to npx node-bundletool if bundletool is not in PATH
      // We use -y to avoid interactive prompt for installation
      if (await needsNpxDownload()) {
        console.log(t('aabBundletoolDownloadHint'));
      }
      await runCommand(
        'npx',
        [
          '-y',
          'node-bundletool',
          'build-apks',
          '--mode=universal',
          `--bundle=${bundlePath}`,
          `--output=${tempApksPath}`,
          '--overwrite',
          ...modulesArgs,
        ],
        {
          stdio: 'inherit',
          env: {
            ...process.env,
            npm_config_progress: 'true',
          },
        },
      );
    }

    // 2. Extract universal.apk from the .apks (zip) file
    const found = await extractFirstEntry(
      tempApksPath,
      (name) => name === 'universal.apk',
      outputPath,
    );
    if (!found) {
      throw new Error(t('aabUniversalApkNotFound'));
    }
  } finally {
    // Cleanup
    if (await pathExists(tempDir)) {
      await remove(tempDir);
    }
  }
}
