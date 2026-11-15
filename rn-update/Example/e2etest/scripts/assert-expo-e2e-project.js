#!/usr/bin/env node
/**
 * [INPUT]: 依赖生成证明、显式候选摘要、宿主物理安装树与 Expo prebuild 结果
 * [OUTPUT]: 提供 assertExpoProject 与 CLI，验证完整候选、框架单源、正常原生入口和限定网络
 * [POS]: Expo 隔离宿主的构建前门卫；不安装依赖、不访问设备、不把校验代称运行通过
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readCandidate } = require('../../../scripts/package-candidate');
const { VERSIONS, PACKAGE, digest } = require('./create-expo-e2e-project');

function assertExpoProject({ project, sha256 } = {}) {
  assert(project && sha256, '--project and --sdk-sha256 are required');
  const root = fs.realpathSync(project);
  const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
  const json = (name) => JSON.parse(read(name));
  const proof = json('expo-e2e-project.json');
  assert.equal(
    proof.project,
    root,
    'Generated project was moved or belongs to another host'
  );
  const candidate = readCandidate(
    path.join(root, 'rn-update-candidate.tgz'),
    sha256
  );
  assert.equal(
    candidate.sha256,
    proof.candidate.sha256,
    'Candidate differs from generation proof'
  );
  assert.equal(candidate.files.length, proof.candidate.files);
  const host = json('package.json');
  assert.equal(host.main, 'index.js');
  assert.equal(
    host.dependencies['rn-update'],
    'file:./rn-update-candidate.tgz'
  );
  const app = json('app.json').expo;
  assert.equal(app.android.package, PACKAGE);
  assert.deepEqual(
    app.plugins,
    [
      ['rn-update', { channel: 'expo-host-probe' }],
      './plugins/with-e2e-network',
    ],
    'Keep the generated channel and network plugins enabled'
  );
  const modules = fs.realpathSync(path.join(root, 'node_modules'));
  assert.equal(
    modules,
    path.join(root, 'node_modules'),
    'Host node_modules must be physical'
  );
  const sdk = path.join(modules, 'rn-update');
  assert.equal(
    fs.realpathSync(sdk),
    sdk,
    'SDK must be a physical install inside the host'
  );
  const dependencies = {};
  for (const [name, version] of Object.entries(VERSIONS)) {
    assert.equal(host.dependencies[name], version, `Expected pinned ${name}`);
    const resolved = fs.realpathSync(
      require.resolve(`${name}/package.json`, { paths: [root] })
    );
    assert.equal(
      resolved,
      path.join(modules, name, 'package.json'),
      `${name} must resolve inside the host`
    );
    assert.equal(
      fs.realpathSync(
        require.resolve(`${name}/package.json`, { paths: [sdk] })
      ),
      resolved,
      `${name} must resolve from one host tree for SDK and app`
    );
    assert.equal(
      JSON.parse(fs.readFileSync(resolved, 'utf8')).version,
      version,
      `Installed ${name} version differs`
    );
    dependencies[name] = { version, package: resolved };
  }
  for (const [name, expected] of Object.entries({
    ...proof.sourceFiles,
    ...proof.generatedFiles,
  }))
    assert.equal(
      digest(fs.readFileSync(path.join(root, name))),
      expected,
      `Generated harness differs: ${name}`
    );
  // ---------- readCandidate已拒绝链接与路径逃逸；仅在自有TEMP中解包逐文件比较 ----------
  const temporary = fs.realpathSync(os.tmpdir());
  const scratch = fs.mkdtempSync(
    path.join(temporary, 'pakta-expo-candidate-check-')
  );
  try {
    execFileSync('tar', ['-xzf', candidate.tarball, '-C', scratch]);
    for (const name of candidate.files) {
      const installed = path.join(sdk, name);
      assert.equal(
        fs.realpathSync(installed),
        installed,
        `Candidate member must be physical: ${name}`
      );
      assert.deepEqual(
        fs.readFileSync(installed),
        fs.readFileSync(path.join(scratch, 'package', name)),
        `Installed candidate differs: ${name}`
      );
    }
  } finally {
    assert(
      path.dirname(scratch) === temporary,
      'Candidate scratch escaped TEMP'
    );
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  assert.match(
    manifest,
    /android:networkSecurityConfig="@xml\/network_security_config"/
  );
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
  const policy = read(
    'android/app/src/main/res/xml/network_security_config.xml'
  );
  assert.deepEqual(
    [...policy.matchAll(/<domain\b[^>]*>([^<]+)<\/domain>/g)].map(
      (match) => match[1]
    ),
    ['10.0.2.2']
  );
  assert.match(policy, /<base-config cleartextTrafficPermitted="false"\s*\/>/);
  assert.match(
    policy,
    /<domain includeSubdomains="false">10\.0\.2\.2<\/domain>/
  );
  assert.equal((policy.match(/<base-config\b/g) || []).length, 1);
  assert.equal((policy.match(/<domain-config\b/g) || []).length, 1);
  assert.match(policy, /<domain-config cleartextTrafficPermitted="true">/);
  const application = read(
    `android/app/src/main/java/${PACKAGE.replaceAll('.', '/')}/MainApplication.kt`
  );
  assert.match(application, /ExpoReactHostFactory\.getDefaultReactHost\(/);
  assert.match(
    application,
    /ApplicationLifecycleDispatcher\.onApplicationCreate\(this\)/
  );
  assert.doesNotMatch(
    application,
    /getJSBundleFile|UpdateContext|getBundleUrl|setBaseJSBundlePath/
  );
  assert.match(
    read('android/app/build.gradle'),
    /bundleCommand\s*=\s*"export:embed"/
  );
  assert.doesNotMatch(
    read('android/gradle.properties'),
    /^newArchEnabled=false\r?$/m
  );
  assert(
    fs.existsSync(path.join(root, 'package-lock.json')),
    'Save a normal complete npm installation lock'
  );
  const result = {
    status: 'validated',
    project: root,
    package: PACKAGE,
    candidate: proof.candidate,
    dependencies,
    sourceFiles: Object.keys(proof.sourceFiles).length,
    scope:
      'installed candidate and generated Expo Android host; no build or device claim',
  };
  return result;
}

if (require.main === module) {
  const options = {};
  const names = { '--project': 'project', '--sdk-sha256': 'sha256' };
  for (let index = 2; index < process.argv.length; index += 2) {
    const name = names[process.argv[index]];
    assert(
      name && process.argv[index + 1] && !(name in options),
      'Expected --project DIR --sdk-sha256 SHA'
    );
    options[name] = process.argv[index + 1];
  }
  const output =
    options.project &&
    path.join(path.resolve(options.project), 'expo-e2e-validation.json');
  try {
    const result = assertExpoProject(options);
    fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    if (output && fs.existsSync(path.dirname(output)))
      fs.writeFileSync(
        output,
        `${JSON.stringify({ status: 'failed', error: String(error.stack || error) }, null, 2)}\n`
      );
    throw error;
  }
}
module.exports = { assertExpoProject };
