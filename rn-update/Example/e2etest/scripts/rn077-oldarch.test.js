/**
 * [INPUT]: 依赖 Node test/vm、真实 harness 和临时候选归档
 * [OUTPUT]: 持久验证 TEMP 生成、候选安装、Release 与架构正负控
 * [POS]: RN077 生成器离线回归，不下载模板、不执行 Gradle、不冒充设备证据
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { generateProject } = require('./create-rn077-oldarch-project');
const assertRn077 = require('./assert-rn077-oldarch');

function write(root, file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pakta-rn077-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sdk = path.join(root, 'package');
  const metadata = require('../../../package.json');
  write(
    sdk,
    'package.json',
    JSON.stringify({ name: metadata.name, version: metadata.version })
  );
  for (const file of [
    'src/index.ts',
    'src/NativePakta.ts',
    'android/build.gradle',
    'android/src/oldarch/cn/reactnative/modules/update/UpdateModule.java',
    'android/src/oldarch/cn/reactnative/modules/update/NativePaktaSpec.java',
  ])
    write(sdk, file, file);
  const tarball = path.join(root, 'candidate with spaces.tgz');
  execFileSync('tar', ['-czf', tarball, '-C', root, 'package']);
  const initialize = (command, args, { cwd }) => {
    assert.equal(command, 'npx');
    assert(args.includes('@react-native-community/cli@15.0.1'));
    assert(args.includes('0.77.3'));
    const project = path.join(cwd, 'AwesomeProject');
    write(project, 'package.json', '{"version":"0.0.1","devDependencies":{}}');
    write(project, 'android/gradle.properties', 'newArchEnabled=true\n');
    write(
      project,
      'android/app/build.gradle',
      'versionName "1.0"\nrelease {\n // Caution!\n}\ndependencies {\nimplementation("com.facebook.react:react-android")\n}\n'
    );
    write(
      project,
      'android/app/src/main/AndroidManifest.xml',
      'android:theme="@style/AppTheme"'
    );
    write(
      project,
      'android/app/src/main/java/com/awesomeproject/MainApplication.kt',
      'import com.facebook.soloader.SoLoader\n        override fun getJSMainModuleName(): String = "index"\n'
    );
  };
  return {
    root,
    sdk,
    tarball,
    initialize,
    workspaceRoot: path.join(root, 'outside repository'),
  };
}

test('TEMP generation consumes one local tarball and rewrites both resolvers', (t) => {
  const options = fixture(t);
  const root = generateProject(options);
  const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
  assert.equal(
    JSON.parse(read('package.json')).dependencies['rn-update'],
    'file:./rn-update-candidate.tgz'
  );
  const nodeConfig = JSON.parse(read('tsconfig.node.json'));
  assert.equal(nodeConfig.compilerOptions.module, 'Node16');
  assert(
    nodeConfig.include.includes('scripts/prepare-local-update-artifacts.ts')
  );
  assert(!JSON.parse(read('tsconfig.json')).compilerOptions.paths);
  for (const config of ['metro.config.js', 'react-native.config.js']) {
    assert(
      read(config).includes("path.join(__dirname, 'node_modules', 'rn-update')")
    );
    assert(!read(config).includes("path.resolve(__dirname, '../..')"));
  }
  assert(read('index.js').startsWith('import { assertOldArchitecture }'));
  assert.match(read('android/gradle.properties'), /newArchEnabled=false/);
  assert.match(
    read('android/app/src/main/java/com/awesomeproject/MainApplication.kt'),
    /getJSBundleFile/
  );
  assert(
    fs.existsSync(
      path.join(
        root,
        'android/app/src/main/res/xml/network_security_config.xml'
      )
    )
  );
  assert.throws(() => generateProject(options), /Refusing to overwrite/);
  assert.throws(
    () => generateProject({ ...options, sha256: '0'.repeat(64) }),
    /SHA-256 mismatch/
  );
});

test('installed identity and Release guard reject changed bytes and false oldarch claims', (t) => {
  const options = fixture(t);
  const root = generateProject(options);
  fs.cpSync(options.sdk, path.join(root, 'node_modules/rn-update'), {
    recursive: true,
  });
  write(root, 'node_modules/react-native/package.json', '{"version":"0.77.3"}');
  write(
    root,
    'metro.config.js',
    `const path = require('node:path');
const sdk = path.join(__dirname, 'node_modules', 'rn-update');
const resolver = () => {};
resolver.localSdkRoot = sdk;
resolver.mapModuleName = (name) => name === 'rn-update' ? path.join(sdk, 'src', 'index.ts') : path.join(__dirname, 'node_modules', name);
module.exports = {resolver: {resolveRequest: resolver}};
`
  );
  const configs = [
    'android/app/build/generated/source/buildConfig/release/com/awesomeproject/BuildConfig.java',
    'node_modules/rn-update/android/build/generated/source/buildConfig/release/cn/reactnative/modules/update/BuildConfig.java',
  ];
  for (const file of configs)
    write(root, file, 'IS_NEW_ARCHITECTURE_ENABLED = false;');
  write(
    root,
    'android/app/build/outputs/apk/release/app-release.apk',
    'fixture'
  );
  assertRn077(root, true);
  for (const file of configs) {
    write(root, file, 'IS_NEW_ARCHITECTURE_ENABLED = true;');
    assert.throws(() => assertRn077(root, true));
    write(root, file, 'IS_NEW_ARCHITECTURE_ENABLED = false;');
  }
  write(
    root,
    'node_modules/rn-update/src/NativePakta.ts',
    'registry replacement'
  );
  assert.throws(() => assertRn077(root), /installed candidate differs/);
});

test('runtime proof rejects newer RN, bridgeless, Turbo, Fabric and missing legacy bridge', () => {
  const source = fs.readFileSync(
    path.join(__dirname, 'rn077-runtime-proof.js'),
    'utf8'
  );
  const module = {};
  const pakta = {};
  const globals = { __fbBatchedBridge: {} };
  let version = '0.77.3';
  const context = {
    module,
    global: globals,
    require: (name) => {
      if (name === 'react-native') return { NativeModules: { Pakta: pakta } };
      if (name === 'rn-update') return { UpdateModule: pakta };
      return { version };
    },
  };
  vm.runInNewContext(source, context);
  assert.equal(module.exports.assertOldArchitecture().rn, '0.77.3');
  for (const name of [
    'RN$Bridgeless',
    '__turboModuleProxy',
    'nativeFabricUIManager',
  ]) {
    globals[name] = {};
    assert.throws(
      () => module.exports.assertOldArchitecture(),
      /PAKTA_OLDARCH_FAIL/
    );
    delete globals[name];
  }
  version = '0.85.2';
  assert.throws(
    () => module.exports.assertOldArchitecture(),
    /PAKTA_OLDARCH_FAIL/
  );
  version = '0.77.3';
  delete globals.__fbBatchedBridge;
  assert.throws(
    () => module.exports.assertOldArchitecture(),
    /PAKTA_OLDARCH_FAIL/
  );
});
