#!/usr/bin/env node
/**
 * [INPUT]: 依赖 Node child_process/path 与 Example/e2etest/android 的 Gradle wrapper，接收 Gradle task 和参数
 * [OUTPUT]: 在 Windows、macOS、Linux 统一执行对应 gradlew wrapper，并以原始退出码结束
 * [POS]: e2etest 的跨平台 Android 构建边界，供 npm 脚本和 Detox 复用，避免把 Unix shell 语法泄漏到 Windows
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const androidDir = path.resolve(__dirname, '..', 'android');
const wrapper = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
const result = spawnSync(wrapper, process.argv.slice(2), {
  cwd: androidDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
