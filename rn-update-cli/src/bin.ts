#!/usr/bin/env node

/**
 * [INPUT]: 依赖 cli.json 命令声明、动态命令加载器、会话存储、账号摘要前置提醒、版本提示、本地化文案与源码/编译产物时间戳
 * [OUTPUT]: 对外提供 Pakta CLI 进程入口；统一会话、命令和错误出口，交互命令显示账号/版本，parse* 保持纯 JSON stdout，并阻止运行过期 lib
 * [POS]: CLI 最外层适配器，只负责进程生命周期与命令分发；业务发布、上传和网络协议下沉到 commands 与领域模块
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from 'fs';
import path from 'path';

import { showCurrentAccount } from './account';
import { loadSession } from './api';
import { commandNames, loadCommandHandler } from './commands';
import { printVersionCommand } from './utils';
import { t } from './utils/i18n';
import { isTruthyEnv } from './utils/options';

interface CliArgv {
  command: string;
  args: string[];
  options: Record<string, any>;
}

function newestSourceMtime(directory: string): number {
  let newest = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestSourceMtime(entryPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      newest = Math.max(newest, fs.statSync(entryPath).mtimeMs);
    }
  }
  return newest;
}

function assertFreshLocalBuild() {
  const projectRoot = path.resolve(__dirname, '..');
  const sourceRoot = path.join(projectRoot, 'src');
  if (path.basename(__dirname) !== 'lib' || !fs.existsSync(sourceRoot)) {
    return;
  }
  if (newestSourceMtime(sourceRoot) > fs.statSync(__filename).mtimeMs) {
    throw new Error(t('staleLocalBuild'));
  }
}

function printUsage(exitCode = 1) {
  console.log('React Native Update CLI');
  console.log('');
  console.log('Commands:');
  for (const name of commandNames) {
    console.log(`  ${name}`);
  }

  console.log('');
  console.log('Special commands:');
  console.log('  list: List all available commands');
  console.log('  help: Show this help message');

  console.log('');
  console.log(
    'Visit `https://github.com/pakta-team/rn-update-cli` for documentation.',
  );
  process.exit(exitCode);
}

/**
 * Errors reaching the top level are almost always about the user's input,
 * project or network: print their message. The stack trace, which only helps
 * when the CLI itself is at fault, is printed on request (RNU_DEBUG=1).
 */
function reportError(err: unknown) {
  if (isTruthyEnv(process.env.RNU_DEBUG)) {
    console.error(err instanceof Error ? err.stack : err);
    // fetch failures wrap the real reason (ECONNREFUSED, TLS, ...) as `cause`
    for (
      let cause = (err as { cause?: unknown })?.cause;
      cause;
      cause = (cause as { cause?: unknown })?.cause
    ) {
      console.error('Caused by:', cause);
    }
    return;
  }
  console.error(err instanceof Error ? err.message : String(err));
  console.error(t('errorStackHint'));
}

async function run() {
  try {
    assertFreshLocalBuild();
  } catch (err) {
    reportError(err);
    process.exit(1);
  }
  const versionOnly = ['-v', '--version', 'version'].includes(
    process.argv[2] ?? '',
  );
  // JSON 命令只写业务结果，跳过账号 worker 和版本/自更新提示。
  const jsonOnly = ['parseApp', 'parseIpa', 'parseApk', 'parseAab'].includes(
    process.argv[2] ?? '',
  );
  // The registry check for newer versions runs alongside the command (from a
  // 1-day cache when possible) and only ever delays `-v`/`version` itself; its
  // hint is printed once the command is done, or at exit for commands that
  // exit on their own.
  const versionCheck = jsonOnly
    ? undefined
    : await printVersionCommand({ wait: versionOnly });
  if (versionOnly) {
    versionCheck?.startAutoUpdate();
    process.exit();
  }
  process.on('exit', (code) => {
    if (code === 0) {
      versionCheck?.printHints();
      versionCheck?.startAutoUpdate();
    }
  });

  try {
    // inside the try: an unknown command or option is reported like any other
    // error instead of crashing with an unhandled rejection
    const argv: CliArgv = require('cli-arguments').parse(
      require('../cli.json'),
    );
    global.NO_INTERACTIVE =
      Boolean(argv.options['no-interactive']) ||
      isTruthyEnv(process.env.NO_INTERACTIVE);
    global.USE_ACC_OSS =
      Boolean(argv.options.acc) || isTruthyEnv(process.env.USE_ACC_OSS);

    await loadSession();

    if (argv.command === 'help' || argv.command === 'list') {
      printUsage(0);
    }
    const handler = loadCommandHandler(argv.command);
    if (!handler) {
      throw new Error(t('unknownCommand', { command: argv.command }));
    }
    if (!jsonOnly && argv.command !== 'me') {
      showCurrentAccount();
    }
    await handler(argv);
    // a check still in flight (cold cache) gets a short grace period; the
    // registry request itself is unref'd, so exiting never waits on it
    await versionCheck?.settle(500);
    versionCheck?.printHints();
    versionCheck?.startAutoUpdate();
  } catch (err: any) {
    if (err?.status === 401) {
      console.log(t('loginFirst'));
      process.exit(1);
    }
    reportError(err);
    process.exit(1);
  }
}

run();
