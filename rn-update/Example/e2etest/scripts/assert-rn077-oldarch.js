/**
 * [INPUT]: 依赖宿主候选清单、安装树、Metro/CLI 配置与可选 Release 构建物
 * [OUTPUT]: 提供 assertRn077 和 --release 命令，拒绝错包、错根及伪旧架构
 * [POS]: RN077 构建前后守门器，与运行时桥接断言互补，不替代设备验证
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

function assertRn077(
  projectRoot = path.resolve(__dirname, '..'),
  release = false
) {
  const read = (file) => fs.readFileSync(path.join(projectRoot, file), 'utf8');
  const json = (file) => JSON.parse(read(file));
  const manifest = json('rn077-candidate.json');
  const host = json('package.json');
  const sdkRoot = path.join(projectRoot, 'node_modules', 'rn-update');
  const tarball = path.join(projectRoot, 'rn-update-candidate.tgz');
  assert.equal(
    host.dependencies['rn-update'],
    'file:./rn-update-candidate.tgz'
  );
  assert.equal(host.dependencies['react-native'], '0.77.3');
  assert.equal(
    json('node_modules/react-native/package.json').version,
    '0.77.3'
  );
  assert.equal(
    json('node_modules/rn-update/package.json').version,
    manifest.version
  );
  assert.equal(
    createHash('sha256').update(fs.readFileSync(tarball)).digest('hex'),
    manifest.sha256
  );
  for (const file of [
    'package.json',
    'src/index.ts',
    'src/NativePakta.ts',
    'android/build.gradle',
    'android/src/oldarch/cn/reactnative/modules/update/UpdateModule.java',
    'android/src/oldarch/cn/reactnative/modules/update/NativePaktaSpec.java',
  ]) {
    const expected = execFileSync('tar', ['-xOf', tarball, `package/${file}`]);
    assert.deepEqual(
      fs.readFileSync(path.join(sdkRoot, file)),
      expected,
      `installed candidate differs: ${file}`
    );
  }
  assert.match(read('android/gradle.properties'), /^newArchEnabled=false\r?$/m);
  const native = require(path.join(projectRoot, 'react-native.config.js'));
  assert.equal(native.dependencies['rn-update'].root, sdkRoot);
  const resolver = require(path.join(projectRoot, 'metro.config.js')).resolver
    .resolveRequest;
  assert.equal(resolver.localSdkRoot, sdkRoot);
  assert.equal(
    resolver.mapModuleName('rn-update'),
    path.join(sdkRoot, 'src', 'index.ts')
  );
  for (const name of ['react', 'react-native']) {
    assert.equal(
      resolver.mapModuleName(name),
      path.join(projectRoot, 'node_modules', name)
    );
  }
  if (release) {
    for (const file of [
      'android/app/build/generated/source/buildConfig/release/com/awesomeproject/BuildConfig.java',
      'node_modules/rn-update/android/build/generated/source/buildConfig/release/cn/reactnative/modules/update/BuildConfig.java',
    ]) {
      assert.match(read(file), /IS_NEW_ARCHITECTURE_ENABLED\s*=\s*false\s*;/);
    }
    assert(
      fs.statSync(
        path.join(
          projectRoot,
          'android/app/build/outputs/apk/release/app-release.apk'
        )
      ).size > 0
    );
  }
  process.stdout.write(
    `RN077 candidate ${manifest.version} verified${release ? ' (Release)' : ''}\n`
  );
  return sdkRoot;
}

module.exports = assertRn077;
if (require.main === module)
  assertRn077(undefined, process.argv.includes('--release'));
