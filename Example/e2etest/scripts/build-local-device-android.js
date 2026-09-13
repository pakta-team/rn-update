#!/usr/bin/env node
/**
 * [INPUT]: 依赖 RNU_E2E_LOCAL_ENDPOINT/RNU_E2E_APP_KEY 环境变量、Node 文件系统与 Android Gradle
 * [OUTPUT]: 生成绑定局域网本地 E2E 服务的 Android Release APK
 * [POS]: e2etest 真机本地服务适配器；与面向 Go API 的 build-real-service-android.js 分离
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const rawEndpoint = process.env.RNU_E2E_LOCAL_ENDPOINT?.trim();
const appKey = process.env.RNU_E2E_APP_KEY?.trim() || 'local-e2e-android';

if (!rawEndpoint) {
  console.error(
    'RNU_E2E_LOCAL_ENDPOINT is required, for example http://192.168.1.21:31337'
  );
  process.exit(1);
}

let endpoint;
try {
  const parsed = new URL(rawEndpoint);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('only http/https is supported');
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new Error('path must be empty');
  }
  if (parsed.search || parsed.hash) {
    throw new Error('query and hash are not supported');
  }
  endpoint = parsed.origin;
} catch (error) {
  console.error(`RNU_E2E_LOCAL_ENDPOINT is invalid: ${error.message}`);
  process.exit(1);
}

const entryFile = path.join(projectRoot, '.local-device-entry.js');
fs.writeFileSync(
  entryFile,
  [
    `globalThis.__RNU_E2E_UPDATE_CONFIG = ${JSON.stringify({ appKey, endpoint })};`,
    "require('./index.js');",
    '',
  ].join('\n')
);

console.log(`Building Android APK for local E2E service ${endpoint}`);
const result = spawnSync(
  process.execPath,
  [path.join(__dirname, 'run-gradle.js'), '--no-daemon', 'assembleRelease'],
  {
    cwd: projectRoot,
    env: { ...process.env, RNU_ENTRY_FILE: entryFile },
    stdio: 'inherit',
  }
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
