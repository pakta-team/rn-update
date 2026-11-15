#!/usr/bin/env node
/**
 * [INPUT]: 依赖显式本地 SDK tgz/摘要、e2etest UI/版本入口与隔离网络插件模板
 * [OUTPUT]: 提供 generateProject 与 CLI，创建 Expo57/RN0.86.3 的 fresh 消费宿主及输入证明
 * [POS]: Expo 真 OTA/坏 JS 验收的工程边界；只生成文件，安装、prebuild、Gradle 由调用方逐步执行
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { readCandidate } = require('../../../scripts/package-candidate');

const VERSIONS = { expo: '57.0.22', react: '19.2.3', 'react-native': '0.86.3' };
const PACKAGE = 'space.yoghourt.pakta.expoprobe';
const ENTRIES = [
  'entry.v1.ts',
  'entry.v2.ts',
  'entry.v3.ts',
  'entry.v4.ts',
  'entry.brick.ts',
  'entry.fix.ts',
  'entry.rescue-fix.ts',
];

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function generateProject({
  project,
  source = path.resolve(__dirname, '..'),
  tarball,
  sha256,
} = {}) {
  assert(
    project && tarball && sha256,
    '--project, --sdk-tarball and --sdk-sha256 are required'
  );
  const destination = path.resolve(project);
  assert(
    !fs.existsSync(destination),
    `Refusing to overwrite existing project: ${destination}`
  );
  const candidate = readCandidate(tarball, sha256);
  const sourceRoot = fs.realpathSync(source);
  const files = new Map();
  function collect(relative) {
    const file = path.join(sourceRoot, relative);
    const stat = fs.lstatSync(file);
    assert(!stat.isSymbolicLink(), `Source must be physical: ${file}`);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(file).sort())
        collect(`${relative}/${name}`);
    } else {
      assert(stat.isFile(), `Source must be a regular file: ${file}`);
      files.set(relative, fs.readFileSync(file));
    }
  }
  collect('src');
  for (const file of [
    ...ENTRIES.map((name) => `e2e/${name}`),
    'e2e/localUpdateConfig.ts',
    'scripts/local-e2e-server.ts',
  ])
    collect(file);
  assert(files.has('src/index.tsx'), 'Source is missing its shared UI');
  assert.match(files.get('e2e/localUpdateConfig.ts').toString(), /10\.0\.2\.2/);
  const plugin = fs.readFileSync(
    path.join(__dirname, 'expo-e2e-network-plugin.js')
  );
  // ---------- 全部输入通过后才创建工程，不下载依赖或调用平台工具 ----------
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.mkdirSync(destination);
  const sourceFiles = {};
  function write(relative, bytes) {
    fs.mkdirSync(path.dirname(path.join(destination, relative)), {
      recursive: true,
    });
    fs.writeFileSync(path.join(destination, relative), bytes);
  }
  function json(relative, value) {
    write(relative, `${JSON.stringify(value, null, 2)}\n`);
  }
  for (const [relative, bytes] of files) {
    write(relative, bytes);
    sourceFiles[relative] = digest(bytes);
  }
  fs.copyFileSync(
    candidate.tarball,
    path.join(destination, 'rn-update-candidate.tgz')
  );
  json('package.json', {
    name: 'pakta-expo-e2e-probe',
    version: '1.0.0',
    private: true,
    main: 'index.js',
    scripts: {
      start: 'expo start',
      android: 'expo run:android',
      ios: 'expo run:ios',
    },
    dependencies: {
      ...VERSIONS,
      'rn-update': 'file:./rn-update-candidate.tgz',
    },
    engines: { node: '>=22' },
  });
  json('app.json', {
    expo: {
      name: 'PaktaExpoProbe',
      slug: 'pakta-expo-probe',
      version: '1.0.0',
      android: { package: PACKAGE },
      plugins: [
        ['rn-update', { channel: 'expo-host-probe' }],
        './plugins/with-e2e-network',
      ],
    },
  });
  const header = (input, output, pos) =>
    `/**\n * [INPUT]: ${input}\n * [OUTPUT]: ${output}\n * [POS]: ${pos}\n * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md\n */\n`;
  write(
    'index.js',
    header(
      '依赖 Expo 根组件注册与共享 e2etest UI',
      '注册标准 Expo 应用入口',
      '隔离宿主正常基座，不注入 SDK 状态或更新 bundle'
    ) +
      "import { registerRootComponent } from 'expo';\nimport App from './src';\nregisterRootComponent(App);\n"
  );
  write(
    'metro.config.js',
    header(
      '依赖本宿主 Expo Metro 默认配置',
      '提供单 worker 打包配置',
      '全部依赖沿宿主物理安装树解析'
    ) +
      "const { getDefaultConfig } = require('expo/metro-config');\nconst config = getDefaultConfig(__dirname);\nconfig.maxWorkers = 1;\nmodule.exports = config;\n"
  );
  write(
    'babel.config.js',
    `${header(
      '依赖本宿主 babel-preset-expo',
      '提供 Expo TS/JSX 转换配置',
      '基座与更新包共用 Expo 编译语义'
    )}module.exports = { presets: ['babel-preset-expo'] };\n`
  );
  write('plugins/with-e2e-network.js', plugin);
  const generatedFiles = Object.fromEntries(
    [
      'index.js',
      'metro.config.js',
      'babel.config.js',
      'plugins/with-e2e-network.js',
    ].map((name) => [
      name,
      digest(fs.readFileSync(path.join(destination, name))),
    ])
  );
  write(
    'CLAUDE.md',
    '# PaktaExpoProbe - Expo 隔离验收宿主\nExpo57.0.22 + React19.2.3 + RN0.86.3 + 显式本地SDK候选\n\nsrc/ - 共享样例UI；e2e/ - 版本与故障入口；scripts/ - 本地服务；plugins/ - 仅10.0.2.2测试网络。\n\npackage.json/package-lock.json固定安装输入，expo-e2e-project.json记录候选与复制源码摘要；index.js使用registerRootComponent，不写原生更新状态。\n\n[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md\n'
  );
  for (const [directory, members] of Object.entries({
    e2e: [
      'localUpdateConfig.ts: 共享端点/hash/label纯配置',
      ...ENTRIES.map((name) => `${name}: 复用主工程的版本或坏JS验收入口`),
    ],
    scripts: ['local-e2e-server.ts: 复用共享本地更新协议与只读请求观测'],
    plugins: [
      'with-e2e-network.js: prebuild固定Manifest和XML，仅允许10.0.2.2明文',
    ],
  }))
    write(
      `${directory}/CLAUDE.md`,
      `# ${directory}/\n> L2 | 父级: ../CLAUDE.md\n\n${members.join('\n')}\n\n[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md\n`
    );
  json('expo-e2e-project.json', {
    status: 'created',
    project: fs.realpathSync(destination),
    source: sourceRoot,
    package: PACKAGE,
    versions: VERSIONS,
    candidate: {
      version: candidate.metadata.version,
      sha256: candidate.sha256,
      files: candidate.files.length,
    },
    sourceFiles,
    generatedFiles,
  });
  process.stdout.write(`Created Expo e2e project: ${destination}\n`);
  return destination;
}

if (require.main === module) {
  const options = {};
  const names = {
    '--project': 'project',
    '--source': 'source',
    '--sdk-tarball': 'tarball',
    '--sdk-sha256': 'sha256',
  };
  for (let index = 2; index < process.argv.length; index += 2) {
    const name = names[process.argv[index]];
    assert(
      name && process.argv[index + 1] && !(name in options),
      'Expected unique --project DIR --source DIR --sdk-tarball FILE --sdk-sha256 SHA arguments'
    );
    options[name] = process.argv[index + 1];
  }
  generateProject(options);
}
module.exports = { generateProject, VERSIONS, PACKAGE, digest };
