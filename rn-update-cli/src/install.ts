/**
 * [INPUT]: 依赖子进程、命令上下文、Pakta CLI 常量、本地化文案与包管理器运行时探测
 * [OUTPUT]: 对外提供 installCommands，生成并执行依赖安装命令
 * [POS]: CLI 依赖安装命令边界，校验包参数并委托当前包管理器，不直接修改发布模型
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { spawnSync } from 'child_process';
import path from 'path';
import type { CommandContext } from './types';
import { scriptName } from './utils/constants';
import { t } from './utils/i18n';
import { getInstallCommand } from './utils/runtime';

// package names / version specs only — rejects shell metacharacters since
// Windows needs shell: true to run package manager .cmd shims
const SAFE_PACKAGE_ARG = /^[@a-z0-9^~._/-]+$/i;

export const installCommands = {
  install: async ({ args }: CommandContext) => {
    if (args.length === 0) {
      throw new Error(t('installPackageRequired', { scriptName }));
    }
    for (const arg of args) {
      if (!SAFE_PACKAGE_ARG.test(arg)) {
        throw new Error(t('installPackageRequired', { scriptName }));
      }
    }

    const cliDir = path.resolve(__dirname, '..');
    const installCommand = getInstallCommand(args, cliDir);

    const result = spawnSync(installCommand.command, installCommand.args, {
      cwd: cliDir,
      stdio: 'inherit',
      // package manager executables are .cmd shims on Windows
      shell: process.platform === 'win32',
    });

    if (result.error) {
      throw new Error(
        t('installFailed', {
          packages: args.join(' '),
          error: result.error.message,
        }),
      );
    }
    if (result.status !== 0) {
      throw new Error(
        t('installFailed', {
          packages: args.join(' '),
          error: `${installCommand.command} exited with code ${result.status}`,
        }),
      );
    }
  },
};
