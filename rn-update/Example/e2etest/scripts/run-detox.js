#!/usr/bin/env node
/**
 * [INPUT]: 依赖 Node child_process、Detox CLI 与平台标签/命令行参数
 * [OUTPUT]: 在 Windows、macOS、Linux 统一注入 E2E_PLATFORM 并执行 Detox
 * [POS]: e2etest 的跨平台 Detox 命令边界，避免 npm 脚本依赖 Unix 环境变量语法
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const [platform, ...detoxArgs] = process.argv.slice(2);
if (platform !== 'android' && platform !== 'ios') {
  console.error(
    'Usage: node scripts/run-detox.js <android|ios> <detox args...>'
  );
  process.exit(2);
}

const detoxCli = path.join(
  __dirname,
  '..',
  'node_modules',
  'detox',
  'local-cli',
  'cli.js'
);
const result = spawnSync(process.execPath, [detoxCli, ...detoxArgs], {
  cwd: path.resolve(__dirname, '..'),
  env: { ...process.env, E2E_PLATFORM: platform },
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
