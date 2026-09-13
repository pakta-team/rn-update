#!/usr/bin/env node
/**
 * [INPUT]: 依赖 RNU_E2E_APP_KEY/RNU_E2E_SERVER/RNU_E2E_CHANNEL/RNU_E2E_PACKAGE_VERSION/RNU_CLI_ROOT 环境变量、Node 文件系统、Android Gradle 与 CLI bundle 入口
 * [OUTPUT]: 生成忽略提交的真服务 JS 入口，并按 apk/ppk 模式构建绑定同一控制面的 Android Release 制品；APK 的 channel/packageVersion 可由验收环境参数化
 * [POS]: e2etest 真机验收适配器；保证二进制基线与热更 bundle 共享网络配置，默认本地 Detox 构建不受影响
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const mode = process.argv[2] || 'apk';
const appKey = process.env.RNU_E2E_APP_KEY?.trim();
const rawEndpoint = process.env.RNU_E2E_SERVER?.trim();
const packageVersion = process.env.RNU_E2E_PACKAGE_VERSION?.trim() || '1.84.1';
const nativeChannel = (process.env.RNU_E2E_CHANNEL?.trim() || 'default').toLowerCase();

if (mode !== 'apk' && mode !== 'ppk') {
  console.error('mode must be apk or ppk');
  process.exit(1);
}

if (!appKey) {
  console.error('RNU_E2E_APP_KEY is required');
  process.exit(1);
}

if (!/^[^\s]{1,80}$/.test(packageVersion)) {
  console.error('RNU_E2E_PACKAGE_VERSION must be 1-80 non-whitespace characters');
  process.exit(1);
}

if (!/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test(nativeChannel)) {
  console.error('RNU_E2E_CHANNEL must be a lowercase 1-64 character channel code');
  process.exit(1);
}

let endpoint;
let serviceRoot;
try {
  const parsed = new URL(rawEndpoint || '');
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('only http/https is supported');
  }
  const pathName = parsed.pathname.replace(/\/+$/, '');
  if (pathName && pathName !== '/api') {
    throw new Error('path must be empty or /api');
  }
  serviceRoot = parsed.origin;
  endpoint = `${serviceRoot}/api`;
} catch (error) {
  console.error(`RNU_E2E_SERVER is invalid: ${error.message}`);
  process.exit(1);
}

const artifactsRoot = path.join(projectRoot, '.e2e-artifacts');
const entryFile = path.join(
  artifactsRoot,
  mode === 'apk' ? 'real-service-entry.js' : 'real-service-update-entry.js'
);
fs.mkdirSync(artifactsRoot, { recursive: true });
const bootstrap = [
  `globalThis.__RNU_E2E_UPDATE_CONFIG = ${JSON.stringify({ appKey, endpoint })};`,
];
if (mode === 'ppk') {
  bootstrap.push(
    `globalThis.__RNU_E2E_BUNDLE_LABEL = ${JSON.stringify(process.env.RNU_E2E_UPDATE_LABEL?.trim() || 'REAL_SERVICE_UPDATE')};`
  );
}
fs.writeFileSync(
  entryFile,
  [...bootstrap, "require('../index.js');", ''].join('\n')
);

let command;
let args;
let childEnvironment = process.env;
if (mode === 'apk') {
  console.log(`Building Android APK for ${endpoint} (${nativeChannel}/${packageVersion})`);
  command = process.execPath;
  args = [
    path.join(__dirname, 'run-gradle.js'),
    '--no-daemon',
    'assembleRelease',
  ];
  childEnvironment = { ...process.env, RNU_ENTRY_FILE: entryFile };
} else {
  const cliRoot = path.resolve(
    process.env.RNU_CLI_ROOT ||
      path.join(projectRoot, '..', '..', '..', 'rn-update-cli')
  );
  const cliEntry = path.join(cliRoot, 'lib', 'bin.js');
  if (!fs.existsSync(cliEntry)) {
    console.error(`CLI build entry not found: ${cliEntry}`);
    process.exit(1);
  }
  const outputFile = path.join(artifactsRoot, 'android', 'real-service.ppk');
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  console.log(`Building Android PPK for ${endpoint}`);
  command = process.execPath;
  args = [
    cliEntry,
    'bundle',
    '--platform',
    'android',
    '--entryFile',
    entryFile,
    '--dev',
    'false',
    '--rncli',
    '--output',
    outputFile,
    '--hermes',
    '--no-interactive',
  ];
  childEnvironment = {
    ...process.env,
    RNU_SERVICE_URL: serviceRoot,
    RNU_AUTO_UPDATE: '0',
  };
}

const result = spawnSync(command, args, {
  cwd: projectRoot,
  env: childEnvironment,
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
