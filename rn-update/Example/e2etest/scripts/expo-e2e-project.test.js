/**
 * [INPUT]: 依赖 Node test/vm、真实共享 UI 与临时 SDK 候选/物理宿主夹具
 * [OUTPUT]: 持久验证 fresh 生成、完整候选、依赖单源、正常 Expo 入口和最小网络的正负控
 * [POS]: Expo 生成器离线门卫；不下载依赖、不编译原生、不访问设备或冒充运行验收
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync, spawnSync } = require('node:child_process');
const { test } = require('node:test');
const {
  generateProject,
  VERSIONS,
  PACKAGE,
  digest,
} = require('./create-expo-e2e-project');
const { assertExpoProject } = require('./assert-expo-e2e-project');

function write(root, name, content) {
  const target = path.join(root, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function loadPlugin(project) {
  const callbacks = {};
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(path.join(project, 'plugins/with-e2e-network.js'), 'utf8'),
    {
      module,
      require(name) {
        if (name === 'expo/config-plugins')
          return {
            withAndroidManifest(config, fn) {
              callbacks.manifest = fn;
              return config;
            },
            withDangerousMod(config, [platform, fn]) {
              assert.equal(platform, 'android');
              callbacks.files = fn;
              return config;
            },
          };
        return require(name);
      },
    }
  );
  module.exports({});
  return { ...callbacks, policy: module.exports.NETWORK_POLICY };
}

function fixture(t, installed = true) {
  const temporary = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(temporary, 'pakta-expo-test-'));
  t.after(() => {
    assert.equal(path.dirname(directory), temporary);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const sdk = path.join(directory, 'package');
  const metadata = require('../../../package.json');
  write(
    sdk,
    'package.json',
    JSON.stringify({ name: metadata.name, version: metadata.version })
  );
  write(sdk, 'src/index.ts', 'export const candidate = true;\n');
  write(sdk, 'android/lib/x86_64/librnupdate.so', Buffer.from([1, 0, 2, 0, 3]));
  const tarball = path.join(directory, 'candidate with spaces.tgz');
  execFileSync('tar', ['-czf', tarball, '-C', directory, 'package']);
  const options = {
    project: path.join(directory, 'fresh host with spaces'),
    tarball,
    sha256: digest(fs.readFileSync(tarball)),
  };
  const project = generateProject(options);
  const plugin = loadPlugin(project);
  if (installed) {
    fs.cpSync(sdk, path.join(project, 'node_modules/rn-update'), {
      recursive: true,
    });
    for (const [name, version] of Object.entries(VERSIONS))
      write(
        project,
        `node_modules/${name}/package.json`,
        JSON.stringify({ name, version })
      );
    write(project, 'package-lock.json', '{}\n');
    write(
      project,
      'android/app/src/main/AndroidManifest.xml',
      '<manifest><application android:usesCleartextTraffic="false" android:networkSecurityConfig="@xml/network_security_config" /></manifest>'
    );
    write(
      project,
      'android/app/src/main/res/xml/network_security_config.xml',
      plugin.policy
    );
    write(
      project,
      `android/app/src/main/java/${PACKAGE.replaceAll('.', '/')}/MainApplication.kt`,
      'ExpoReactHostFactory.getDefaultReactHost(\n)\nApplicationLifecycleDispatcher.onApplicationCreate(this)\n'
    );
    write(
      project,
      'android/app/build.gradle',
      'bundleCommand = "export:embed"\n'
    );
    write(project, 'android/gradle.properties', 'newArchEnabled=true\n');
  }
  return { ...options, directory, sdk, plugin };
}

test('fresh generation closes shared UI/entry/candidate inputs without running install or prebuild', (t) => {
  const options = fixture(t, false);
  const read = (name) =>
    fs.readFileSync(path.join(options.project, name), 'utf8');
  assert(!fs.existsSync(path.join(options.project, 'node_modules')));
  assert(!fs.existsSync(path.join(options.project, 'android')));
  assert.match(read('index.js'), /registerRootComponent\(App\)/);
  assert.match(read('metro.config.js'), /expo\/metro-config/);
  assert.doesNotMatch(
    read('index.js'),
    /setLocalHashInfo|probe\.bundle|getBundleUrl/
  );
  const source = path.resolve(__dirname, '..');
  for (const name of [
    'src/index.tsx',
    'e2e/localUpdateConfig.ts',
    'e2e/entry.v1.ts',
    'e2e/entry.brick.ts',
    'e2e/entry.rescue-fix.ts',
  ])
    assert.deepEqual(
      fs.readFileSync(path.join(options.project, name)),
      fs.readFileSync(path.join(source, name))
    );
  const proof = JSON.parse(read('expo-e2e-project.json'));
  assert.equal(proof.candidate.sha256, options.sha256);
  assert.equal(proof.candidate.files, 3);
  assert.equal(proof.package, PACKAGE);
  assert.throws(() => generateProject(options), /Refusing to overwrite/);
});

test('wrong digest or missing source is rejected before creating an output directory', (t) => {
  const options = fixture(t, false);
  const destination = path.join(options.directory, 'rejected host');
  assert.throws(
    () =>
      generateProject({
        ...options,
        project: destination,
        sha256: '0'.repeat(64),
      }),
    /SHA-256 mismatch/
  );
  assert(!fs.existsSync(destination));
  assert.throws(() =>
    generateProject({
      ...options,
      project: destination,
      source: options.directory,
    })
  );
  assert(!fs.existsSync(destination));
});

test('physical installed candidate and normal Expo Android prebuild pass the independent gate', (t) => {
  const options = fixture(t);
  const proof = assertExpoProject(options);
  assert.equal(proof.status, 'validated');
  assert.equal(proof.candidate.files, 3);
  assert.equal(proof.dependencies['react-native'].version, '0.86.3');
});

test('gate compares every candidate file including native bytes and binds an external digest', (t) => {
  const options = fixture(t);
  assert.throws(
    () => assertExpoProject({ ...options, sha256: '0'.repeat(64) }),
    /SHA-256 mismatch/
  );
  write(
    options.project,
    'node_modules/rn-update/android/lib/x86_64/librnupdate.so',
    'wrong binary'
  );
  assert.throws(
    () => assertExpoProject(options),
    /Installed candidate differs/
  );
});

test('failed CLI validation replaces a previous success proof', (t) => {
  const options = fixture(t);
  write(options.project, 'expo-e2e-validation.json', '{"status":"validated"}');
  const result = spawnSync(
    process.execPath,
    [
      path.join(__dirname, 'assert-expo-e2e-project.js'),
      '--project',
      options.project,
      '--sdk-sha256',
      '0'.repeat(64),
    ],
    { encoding: 'utf8' }
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SHA-256 mismatch/);
  const proof = JSON.parse(
    fs.readFileSync(
      path.join(options.project, 'expo-e2e-validation.json'),
      'utf8'
    )
  );
  assert.equal(proof.status, 'failed');
});

test('nested framework and linked SDK are rejected instead of silently consuming a second tree', (t) => {
  const options = fixture(t);
  const nested =
    'node_modules/rn-update/node_modules/react-native/package.json';
  write(
    options.project,
    nested,
    JSON.stringify({ name: 'react-native', version: '0.86.3' })
  );
  assert.throws(() => assertExpoProject(options), /one host tree/);
  const installed = path.join(options.project, 'node_modules/rn-update');
  fs.renameSync(
    installed,
    path.join(options.project, 'node_modules/other-sdk')
  );
  fs.symlinkSync(
    options.sdk,
    installed,
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  assert.throws(() => assertExpoProject(options), /physical install/);
});

test('gate rejects broadened network, custom bundle injection, and disabled new architecture', (t) => {
  const options = fixture(t);
  const checks = [
    [
      'android/app/src/main/res/xml/network_security_config.xml',
      options.plugin.policy.replace('10.0.2.2', 'example.com'),
      /10\.0\.2\.2/,
    ],
    [
      'android/app/src/main/res/xml/network_security_config.xml',
      options.plugin.policy.replace(
        '<base-config cleartextTrafficPermitted="false"',
        '<base-config cleartextTrafficPermitted="true"'
      ),
      /base-config/,
    ],
    [
      `android/app/src/main/java/${PACKAGE.replaceAll('.', '/')}/MainApplication.kt`,
      'ExpoReactHostFactory.getDefaultReactHost(\n)\nApplicationLifecycleDispatcher.onApplicationCreate(this)\ngetJSBundleFile',
      /getJSBundleFile/,
    ],
    ['android/gradle.properties', 'newArchEnabled=false\n', /newArchEnabled/],
  ];
  for (const [name, changed, expected] of checks) {
    const before = fs.readFileSync(path.join(options.project, name));
    write(options.project, name, changed);
    assert.throws(() => assertExpoProject(options), expected);
    write(options.project, name, before);
  }
});

test('gate refuses registry SDK and modified generated UI or entry', (t) => {
  const options = fixture(t);
  const name = path.join(options.project, 'package.json');
  const host = JSON.parse(fs.readFileSync(name, 'utf8'));
  host.dependencies['rn-update'] = '1.1.0';
  fs.writeFileSync(name, JSON.stringify(host));
  assert.throws(
    () => assertExpoProject(options),
    /file:\.\/rn-update-candidate/
  );
  host.dependencies['rn-update'] = 'file:./rn-update-candidate.tgz';
  fs.writeFileSync(name, JSON.stringify(host));
  write(options.project, 'e2e/entry.rescue-fix.ts', 'fake crashRescue proof');
  assert.throws(() => assertExpoProject(options), /Generated harness differs/);
});

test('network plugin is repeatable and refuses replacing an unrelated existing policy', (t) => {
  const { project, plugin } = fixture(t, false);
  const mod = { modResults: { manifest: { application: [{ $: {} }] } } };
  plugin.manifest(mod);
  plugin.manifest(mod);
  assert.equal(
    mod.modResults.manifest.application[0].$['android:usesCleartextTraffic'],
    'false'
  );
  plugin.files({
    modRequest: { platformProjectRoot: path.join(project, 'android') },
  });
  plugin.files({
    modRequest: { platformProjectRoot: path.join(project, 'android') },
  });
  const policy = fs.readFileSync(
    path.join(
      project,
      'android/app/src/main/res/xml/network_security_config.xml'
    ),
    'utf8'
  );
  assert.equal(policy, plugin.policy);
  assert.deepEqual(
    [...policy.matchAll(/<domain\b[^>]*>([^<]+)<\/domain>/g)].map(
      (match) => match[1]
    ),
    ['10.0.2.2']
  );
  mod.modResults.manifest.application[0].$['android:networkSecurityConfig'] =
    '@xml/production';
  assert.throws(() => plugin.manifest(mod), /Refusing to replace/);
});
