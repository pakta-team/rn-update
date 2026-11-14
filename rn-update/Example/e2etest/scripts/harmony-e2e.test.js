/**
 * [INPUT]: 依赖 Node 内置测试器、临时物理依赖树与 Harmony 编排入口
 * [OUTPUT]: 验证候选摘要/源码、RN 依赖隔离、真实差分、显式设备和清理边界的持久正负控
 * [POS]: scripts 的 Harmony 编排回归；不把命令规划验证冒充真实 HAP 构建或设备通过
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const {
  context,
  main,
  assertDigest,
  assertLocalSdk,
  assertArtifacts,
  deviceArgs,
  removeGeneratedDependencies,
} = require('./run-harmony-e2e');

function put(file, content = 'fixture') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harmony orchestrator '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sdkRoot = path.join(root, 'sdk');
  const appRoot = path.join(root, 'sample');
  const e2eRoot = path.join(root, 'e2etest');
  const project = path.join(root, 'short');
  const home = path.join(root, 'DevEco with spaces');
  const har = path.join(sdkRoot, 'harmony', 'pakta.har');
  put(har);
  const harSha = crypto.createHash('sha256').update('fixture').digest('hex');
  const calls = [];
  const ctx = context(
    {
      RNU_HARMONY_PROJECT: project,
      RNU_HARMONY_HAR_PATH: har,
      RNU_HARMONY_HAR_SHA256: harSha,
      DEVECO_STUDIO_HOME: home,
    },
    {
      sdkRoot,
      appRoot,
      e2eRoot,
      platform: 'win32',
      run(command, args, options) {
        calls.push({ command, args, options });
        if (args.includes('assembleHap'))
          put(
            path.join(
              project,
              'entry/build/default/outputs/default/entry-default-signed.hap'
            )
          );
      },
    }
  );
  put(path.join(sdkRoot, 'src', 'index.ts'), 'export const sdk = 1;');
  put(path.join(ctx.installedSdk, 'src', 'index.ts'), 'export const sdk = 1;');
  put(path.join(ctx.installedSdk, 'package.json'), '{"name":"rn-update"}');
  put(path.join(appRoot, 'package.json'), '{"name":"sample"}');
  for (const [name, version] of Object.entries({
    react: '18.2.0',
    'react-native': '0.72.5',
    '@react-native-oh/react-native-harmony': '0.72.96',
  })) {
    put(
      path.join(appRoot, 'node_modules', name, 'package.json'),
      JSON.stringify({ name, version })
    );
  }
  put(path.join(project, 'hvigorfile.ts'));
  put(
    path.join(project, 'entry', 'build-profile.json5'),
    '{abiFilters: ["arm64-v8a", "x86_64"]}'
  );
  put(path.join(project, 'pakta.har'));
  put(path.join(sdkRoot, 'harmony', 'hvigor-plugin.ts'));
  put(path.join(project, 'pakta-hvigor-plugin.ts'));
  const nativeRoot = path.join(
    sdkRoot,
    'harmony',
    'pakta',
    'src',
    'main',
    'cpp'
  );
  put(path.join(nativeRoot, 'PaktaTurboModule.cpp'));
  put(
    path.join(project, 'entry', 'src', 'main', 'cpp', 'CMakeLists.txt'),
    `set(PAKTA_CPP_DIR "${nativeRoot.replaceAll(path.sep, '/')}")`
  );
  put(
    path.join(
      project,
      'entry',
      'src',
      'main',
      'resources',
      'rawfile',
      'bundle.harmony.js'
    )
  );
  put(path.join(home, 'tools/hvigor/bin/hvigorw.js'));
  put(path.join(home, 'tools/ohpm/bin/pm-cli.js'));
  for (const file of [
    'v1.ppk',
    'v2.ppk',
    'v4.ppk',
    'v1-to-v2.ppk.patch',
    'to-v4.v2track.ppk.patch',
  ])
    put(path.join(ctx.artifacts, file));
  put(
    path.join(ctx.artifacts, 'manifest.json'),
    JSON.stringify({ platform: 'harmony', fullFallback: false })
  );
  return { ctx, root, calls };
}

test('physical candidate resolves React/RN/RNOH only from the Harmony dependency tree', (t) => {
  const { ctx } = fixture(t);
  assert.equal(assertLocalSdk(ctx).files, 1);
  put(
    path.join(ctx.installedSdk, 'node_modules', 'react-native', 'package.json'),
    '{"version":"0.85.2"}'
  );
  assert.throws(() => assertLocalSdk(ctx), /root devDependencies/);
});

test('stage verifies and copies candidate bytes before sample dependencies exist', (t) => {
  const { ctx } = fixture(t);
  fs.rmSync(path.join(ctx.appRoot, 'node_modules'), { recursive: true });
  ctx.env.RNU_HARMONY_SDK_TGZ = ctx.har;
  ctx.env.RNU_HARMONY_SDK_SHA256 = ctx.env.RNU_HARMONY_HAR_SHA256;
  main(['stage'], ctx);
  assert.equal(
    fs.readFileSync(
      path.join(ctx.appRoot, '.local-sdk', 'rn-update.tgz'),
      'utf8'
    ),
    'fixture'
  );
  assert.equal(fs.existsSync(path.join(ctx.appRoot, 'node_modules')), false);
});

test('same package version cannot hide missing, stale or extra production source', (t) => {
  const { ctx } = fixture(t);
  put(path.join(ctx.installedSdk, 'src', 'index.ts'), 'export const sdk = 0;');
  assert.throws(() => assertLocalSdk(ctx), /differs from current checkout/);
  put(path.join(ctx.installedSdk, 'src', 'index.ts'), 'export const sdk = 1;');
  put(path.join(ctx.installedSdk, 'src', 'extra.ts'), 'export const old = 1;');
  assert.throws(() => assertLocalSdk(ctx), /inventory differs/);
});

test('workspace SDK links are rejected before a base bundle can see root React Native', (t) => {
  const { ctx } = fixture(t);
  fs.rmSync(ctx.installedSdk, { recursive: true });
  put(path.join(ctx.sdkRoot, 'package.json'), '{"name":"rn-update"}');
  fs.symlinkSync(
    ctx.sdkRoot,
    ctx.installedSdk,
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  assert.throws(() => assertLocalSdk(ctx), /physically isolated/);
});

test('real diff proof rejects fallback, missing declaration, wrong platform and empty patches', (t) => {
  const { ctx } = fixture(t);
  assert.equal(assertArtifacts(ctx).fullFallback, false);
  for (const value of [
    { platform: 'harmony', fullFallback: true },
    { platform: 'harmony' },
    { platform: 'android', fullFallback: false },
  ]) {
    put(path.join(ctx.artifacts, 'manifest.json'), JSON.stringify(value));
    assert.throws(() => assertArtifacts(ctx), /fullFallback|identify harmony/);
  }
  put(
    path.join(ctx.artifacts, 'manifest.json'),
    '{"platform":"harmony","fullFallback":false}'
  );
  put(path.join(ctx.artifacts, 'v1-to-v2.ppk.patch'), '');
  assert.throws(() => assertArtifacts(ctx), /nonempty file/);
});

test('HAR candidates require full exact SHA256 instead of a release label or prefix', (t) => {
  const { ctx } = fixture(t);
  assert.equal(
    assertDigest(ctx.har, ctx.env.RNU_HARMONY_HAR_SHA256, 'HAR'),
    ctx.env.RNU_HARMONY_HAR_SHA256
  );
  assert.throws(
    () =>
      assertDigest(ctx.har, ctx.env.RNU_HARMONY_HAR_SHA256.slice(0, 8), 'HAR'),
    /full SHA256/
  );
  assert.throws(() => assertDigest(ctx.har, '0'.repeat(64), 'HAR'), /mismatch/);
});

test('install requires an explicit HDC target and never sends a command to the first device', (t) => {
  const { ctx, calls } = fixture(t);
  assert.throws(() => main(['install'], ctx), /HDC_TARGET is required/);
  assert.equal(calls.length, 0);
  ctx.env.HDC_TARGET = '127.0.0.1:5557';
  assert.deepEqual(deviceArgs(ctx), ['-t', '127.0.0.1:5557']);
});

test('generated dependency cleanup refuses junction escape before removing any directory', (t) => {
  const { ctx, root } = fixture(t);
  const outside = path.join(root, 'outside');
  put(path.join(outside, 'keep.txt'));
  put(path.join(ctx.project, 'entry', 'oh_modules', 'keep.txt'));
  fs.symlinkSync(
    outside,
    path.join(ctx.project, 'oh_modules'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  assert.throws(
    () => removeGeneratedDependencies(ctx.project),
    /outside project/
  );
  assert.equal(fs.existsSync(path.join(outside, 'keep.txt')), true);
  assert.equal(
    fs.existsSync(path.join(ctx.project, 'entry', 'oh_modules', 'keep.txt')),
    true
  );
});

test('build plans release with both ABIs, preserves argument boundaries and refreshes exact HAR', (t) => {
  const { ctx, calls } = fixture(t);
  main(['build'], ctx);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args.slice(1), ['install', '--all']);
  assert.equal(calls[1].args.includes('buildMode=release'), true);
  assert.equal(calls[1].args.includes('--no-daemon'), true);
  assert.equal(calls[1].options.cwd, ctx.project);
  assert.equal(calls[1].options.shell, undefined);
  put(
    path.join(ctx.project, 'entry', 'build-profile.json5'),
    '{abiFilters: ["arm64-v8a"]}'
  );
  assert.throws(() => main(['build'], ctx), /both arm64-v8a and x86_64/);
  assert.equal(calls.length, 2);
});

test('sync materializes a verified tarball and leaves the SDK checkout untouched', (t) => {
  const { ctx, root } = fixture(t);
  const archiveRoot = path.join(root, 'archive');
  fs.cpSync(ctx.installedSdk, path.join(archiveRoot, 'package'), {
    recursive: true,
  });
  const tgz = path.join(root, 'current candidate.tgz');
  const archive = spawnSync('tar', ['-czf', tgz, '-C', archiveRoot, 'package']);
  assert.equal(archive.status, 0);
  ctx.env.RNU_HARMONY_SDK_TGZ = tgz;
  ctx.env.RNU_HARMONY_SDK_SHA256 = crypto
    .createHash('sha256')
    .update(fs.readFileSync(tgz))
    .digest('hex');
  ctx.run = (command, args) => {
    const result = spawnSync(command, args);
    assert.equal(result.status, 0);
  };
  main(['sync'], ctx);
  assert.equal(fs.lstatSync(ctx.installedSdk).isSymbolicLink(), false);
  assert.equal(
    fs.readFileSync(path.join(ctx.sdkRoot, 'src', 'index.ts'), 'utf8'),
    'export const sdk = 1;'
  );
  assert.equal(assertLocalSdk(ctx).files, 1);
});

test('stale HAP inputs are rejected before any installation command', (t) => {
  const { ctx, calls } = fixture(t);
  main(['build'], ctx);
  ctx.env.HDC_TARGET = '127.0.0.1:5557';
  put(
    path.join(
      ctx.project,
      'entry/build/default/outputs/default/entry-default-signed.hap'
    ),
    'stale HAP'
  );
  assert.throws(() => main(['install'], ctx), /build inputs changed/);
  assert.equal(calls.length, 2);
});

test('short-project native glue cannot silently resolve to a different SDK tree', (t) => {
  const { ctx, calls, root } = fixture(t);
  put(path.join(root, 'wrong-glue', 'PaktaTurboModule.cpp'));
  put(
    path.join(ctx.project, 'entry', 'src', 'main', 'cpp', 'CMakeLists.txt'),
    `set(PAKTA_CPP_DIR "${path.join(root, 'wrong-glue').replaceAll(path.sep, '/')}")`
  );
  assert.throws(() => main(['build'], ctx), /current SDK native glue/);
  assert.equal(calls.length, 0);
});

test('hdc exit zero without successful install output cannot create installation proof', (t) => {
  const { ctx } = fixture(t);
  main(['build'], ctx);
  ctx.env.HDC_TARGET = '127.0.0.1:5557';
  ctx.run = () => ({
    status: 0,
    stdout: '[Fail] install sign info inconsistent',
  });
  assert.throws(() => main(['install'], ctx), /did not confirm/);
  assert.equal(
    fs.existsSync(path.join(ctx.artifacts, 'harmony-install-inputs.json')),
    false
  );
  ctx.run = () => ({ status: 0, stdout: '[Info]App installed successfully.' });
  main(['install'], ctx);
  const proof = JSON.parse(
    fs.readFileSync(
      path.join(ctx.artifacts, 'harmony-install-inputs.json'),
      'utf8'
    )
  );
  assert.equal(proof.target, '127.0.0.1:5557');
});
