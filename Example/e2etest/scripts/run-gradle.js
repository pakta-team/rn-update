#!/usr/bin/env node
/**
 * [INPUT]: 依赖 Node child_process/path 与 Example/e2etest/android 的 Gradle wrapper，接收 Gradle task 和参数
 * [OUTPUT]: Windows 执行批处理、Unix 用 sh 读取 Gradle wrapper，保留参数与退出码且不依赖检出执行位
 * [POS]: e2etest 的跨平台 Android 构建边界，供 npm 脚本和 Detox 复用，避免把 Unix shell 语法泄漏到 Windows
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const androidDir = path.resolve(__dirname, '..', 'android');
const isWindows = process.platform === 'win32';
const wrapper = isWindows ? 'gradlew.bat' : 'sh';
const args = isWindows
  ? process.argv.slice(2)
  : ['./gradlew', ...process.argv.slice(2)];
const result = spawnSync(wrapper, args, {
  cwd: androidDir,
  stdio: 'inherit',
  shell: isWindows,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
