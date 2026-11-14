/**
 * [INPUT]: 依赖 Node 内置测试器、临时物理依赖树/TAR、Harmony 编排入口与依赖复用门卫
 * [OUTPUT]: 验证候选摘要/源码、RN 隔离、真实差分、显式设备、清理及严格 HAR 复用的持久正负控
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
const zlib = require('node:zlib');
const {
  assertReusableDependencies,
  harInventory,
} = require('./harmony-e2e-inputs');
const { REQUIRED_HARMONY_TESTS } = require('./harmony-e2e-results');
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
  const candidate = path.join(root, 'candidate.tgz');
  put(candidate, 'current candidate');
  put(har);
  const harSha = crypto.createHash('sha256').update('fixture').digest('hex');
  const calls = [];
  const ctx = context(
    {
      RNU_HARMONY_PROJECT: project,
      RNU_HARMONY_HAR_PATH: har,
      RNU_HARMONY_HAR_SHA256: harSha,
      RNU_HARMONY_SDK_TGZ: candidate,
      RNU_HARMONY_SDK_SHA256: crypto
        .createHash('sha256')
        .update(fs.readFileSync(candidate))
        .digest('hex'),
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

function reusableFixture(t) {
  const setup = fixture(t);
  const { ctx, root } = setup;
  const source = path.join(root, 'har-source', 'package');
  const store = path.join(
    ctx.project,
    'oh_modules',
    '.ohpm',
    'pakta@fixture',
    'oh_modules',
    'pakta'
  );
  for (const [name, bytes] of Object.entries({
    'oh-package.json5': '{name: "pakta", version: "1.1.0"}',
    'index.ets': 'export const current = true;',
    'libs/x86_64/librnupdate.so': 'current native library',
    '.metadata': 'hidden files belong to the inventory',
  }))
    put(path.join(source, name), bytes);
  const result = spawnSync('tar', [
    '-czf',
    ctx.har,
    '-C',
    path.dirname(source),
    'package',
  ]);
  assert.equal(result.status, 0);
  ctx.env.RNU_HARMONY_HAR_SHA256 = crypto
    .createHash('sha256')
    .update(fs.readFileSync(ctx.har))
    .digest('hex');
  fs.copyFileSync(ctx.har, path.join(ctx.project, 'pakta.har'));
  fs.cpSync(source, store, { recursive: true });
  const installed = path.join(ctx.project, 'entry', 'oh_modules', 'pakta');
  fs.mkdirSync(path.dirname(installed), { recursive: true });
  fs.symlinkSync(
    store,
    installed,
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  put(
    path.join(ctx.project, 'entry', 'oh-package.json5'),
    '{dependencies: {pakta: "file:../pakta.har"}}'
  );
  const lockFile = path.join(ctx.project, 'entry', 'oh-package-lock.json5');
  const lock = {
    specifiers: { 'pakta@../pakta.har': 'pakta@../pakta.har' },
    packages: {
      'pakta@../pakta.har': {
        name: 'pakta',
        version: '1.1.0',
        resolved: '../pakta.har',
        registryType: 'local',
      },
    },
  };
  put(lockFile, JSON.stringify(lock));
  const keep = path.join(ctx.project, 'oh_modules', 'keep.txt');
  put(keep);
  ctx.env.RNU_HARMONY_REUSE_DEPENDENCIES = '1';
  return { ...setup, source, store, installed, lock, lockFile, keep };
}

function refuseReuse(t, mutate, expected) {
  const setup = reusableFixture(t);
  mutate(setup);
  assert.throws(() => main(['build'], setup.ctx), expected);
  assert.equal(setup.calls.length, 0);
  assert.equal(fs.existsSync(setup.keep), true);
}

function firstTarFile(bytes) {
  for (let offset = 0; offset < bytes.length; ) {
    const size = Number.parseInt(
      bytes.subarray(offset + 124, offset + 136).toString('ascii'),
      8
    );
    const next = offset + 512 + Math.ceil(size / 512) * 512;
    if (bytes[offset + 156] === 0 || bytes[offset + 156] === 48)
      return { offset, next };
    offset = next;
  }
  throw new Error('Fixture TAR regular file not found');
}

function updateTarChecksum(header) {
  header.fill(32, 148, 156);
  const checksum = header.reduce((sum, value) => sum + value, 0);
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
}

function mutateHarHeader(ctx, mutate) {
  const bytes = zlib.gunzipSync(fs.readFileSync(ctx.har));
  const { offset } = firstTarFile(bytes);
  const header = bytes.subarray(offset, offset + 512);
  mutate(header);
  updateTarChecksum(header);
  fs.writeFileSync(ctx.har, zlib.gzipSync(bytes));
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
  put(path.join(ctx.project, 'oh_modules', 'stale.txt'));
  main(['build'], ctx);
  assert.equal(
    fs.existsSync(path.join(ctx.project, 'oh_modules', 'stale.txt')),
    false
  );
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
  for (const stdout of [
    '[Fail] install sign info inconsistent',
    '[Info]App installed unsuccessfully.',
    '[Error]Cannot install. App installed successfully.',
  ]) {
    ctx.run = () => ({ status: 0, stdout });
    assert.throws(() => main(['install'], ctx), /did not confirm/);
  }
  assert.equal(
    fs.existsSync(path.join(ctx.artifacts, 'harmony-install-inputs.json')),
    false
  );
  ctx.run = () => ({
    status: 0,
    stdout: Buffer.from(
      require('./hdc-sdk26-install-output.json').stdoutBase64,
      'base64'
    ).toString('utf8'),
  });
  main(['install'], ctx);
  const proof = JSON.parse(
    fs.readFileSync(
      path.join(ctx.artifacts, 'harmony-install-inputs.json'),
      'utf8'
    )
  );
  assert.equal(proof.target, '127.0.0.1:5557');
  assert.equal(proof.candidateSha256, ctx.env.RNU_HARMONY_SDK_SHA256);
});

test('a different tgz invalidates build proof even when all Harmony production inputs match', (t) => {
  const { ctx, calls } = fixture(t);
  main(['build'], ctx);
  ctx.env.HDC_TARGET = 'explicit-target';
  put(ctx.env.RNU_HARMONY_SDK_TGZ, 'different Apple contents');
  ctx.env.RNU_HARMONY_SDK_SHA256 = crypto
    .createHash('sha256')
    .update(fs.readFileSync(ctx.env.RNU_HARMONY_SDK_TGZ))
    .digest('hex');
  assert.throws(() => main(['install'], ctx), /build inputs changed/);
  assert.equal(calls.length, 2);
});

test('test rejects an installation record from another candidate before Jest', (t) => {
  const { ctx } = fixture(t);
  main(['build'], ctx);
  ctx.env.HDC_TARGET = 'explicit-target';
  ctx.run = () => ({ status: 0, stdout: '[Info]App installed successfully.' });
  main(['install'], ctx);
  const file = path.join(ctx.artifacts, 'harmony-install-inputs.json');
  const proof = JSON.parse(fs.readFileSync(file, 'utf8'));
  put(file, JSON.stringify({ ...proof, candidateSha256: '0'.repeat(64) }));
  assert.throws(() => main(['test'], ctx), /not installed by this run/);
});

test('test rejects filtering, no-tests success and runner overrides before any command', (t) => {
  const { ctx, calls } = fixture(t);
  for (const argument of [
    '--passWithNoTests',
    '--testNamePattern=smoke',
    '--config=other.js',
    '--watch',
  ])
    assert.throws(
      () => main(['test', argument], ctx),
      /always runs the full suite/
    );
  assert.equal(calls.length, 0);
});

test('explicit reuse proves every HAR byte and preserves dependencies without OHPM', (t) => {
  const { ctx, calls, keep } = reusableFixture(t);
  const proof = assertReusableDependencies(ctx);
  assert.equal(proof.files, 4);
  assert.equal(proof.version, '1.1.0');
  main(['build'], ctx);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args.includes('assembleHap'), true);
  assert.equal(fs.existsSync(keep), true);
});

test('reuse refuses stale bytes without silently reinstalling', (t) => {
  refuseReuse(
    t,
    ({ store }) => put(path.join(store, 'index.ets'), 'stale'),
    /complete current HAR/
  );
});

test('reuse refuses missing files without removing the dependency tree', (t) => {
  refuseReuse(
    t,
    ({ store }) => fs.unlinkSync(path.join(store, 'index.ets')),
    /complete current HAR/
  );
});

test('reuse includes extra hidden files in the complete installation inventory', (t) => {
  refuseReuse(
    t,
    ({ store }) => put(path.join(store, '.extra'), 'stale'),
    /complete current HAR/
  );
});

test('reuse compares full installed and lock versions against HAR metadata', (t) => {
  refuseReuse(
    t,
    ({ lock, lockFile }) => {
      lock.packages['pakta@../pakta.har'].version = '11.1.0';
      put(lockFile, JSON.stringify(lock));
    },
    /versions differ/
  );
});

test('reuse rejects an installed metadata version drift before build', (t) => {
  refuseReuse(
    t,
    ({ store }) =>
      put(
        path.join(store, 'oh-package.json5'),
        '{name:"pakta",version:"1.1.0-stale"}'
      ),
    /versions differ/
  );
});

test('reuse parses the actual manifest instead of accepting a reference in a comment', (t) => {
  refuseReuse(
    t,
    ({ ctx }) =>
      put(
        path.join(ctx.project, 'entry', 'oh-package.json5'),
        '// pakta: "file:../pakta.har"\n{dependencies:{pakta:"1.1.0"}}'
      ),
    /must be file:/
  );
});

test('reuse rejects stale relative paths, registry identity and duplicate lock references', (t) => {
  for (const change of [
    (lock) => {
      lock.packages['pakta@../pakta.har'].resolved = '../../other/pakta.har';
    },
    (lock) => {
      lock.packages['pakta@../pakta.har'].registryType = 'ohpm';
    },
    (lock) => {
      lock.specifiers['pakta@other.har'] = 'pakta@other.har';
    },
  ]) {
    refuseReuse(
      t,
      ({ lock, lockFile }) => {
        change(lock);
        put(lockFile, JSON.stringify(lock));
      },
      /lock must resolve/
    );
  }
});

test('reuse rejects an entry package link escaping the current project store', (t) => {
  refuseReuse(
    t,
    ({ installed, root, source }) => {
      fs.unlinkSync(installed);
      const outside = path.join(root, 'outside-store');
      fs.cpSync(source, outside, { recursive: true });
      fs.symlinkSync(
        outside,
        installed,
        process.platform === 'win32' ? 'junction' : 'dir'
      );
    },
    /current project OHPM store/
  );
});

test('reuse rejects nested junctions even when target bytes match the HAR', (t) => {
  refuseReuse(
    t,
    ({ store, source }) => {
      const directory = path.join(store, 'libs');
      fs.rmSync(directory, { recursive: true });
      fs.symlinkSync(
        path.join(source, 'libs'),
        directory,
        process.platform === 'win32' ? 'junction' : 'dir'
      );
    },
    /escapes physical package/
  );
});

test('reuse still requires the explicit current HAR full digest', (t) => {
  refuseReuse(
    t,
    ({ ctx }) => {
      ctx.env.RNU_HARMONY_HAR_SHA256 = '0'.repeat(64);
    },
    /SHA256 mismatch/
  );
});

test('unknown reuse flag values fail before destructive dependency refresh', (t) => {
  refuseReuse(
    t,
    ({ ctx }) => {
      ctx.env.RNU_HARMONY_REUSE_DEPENDENCIES = 'true';
    },
    /must be 0 or 1/
  );
});

test('HAR inventory rejects corrupt checksums and truncated member data', (t) => {
  const { ctx } = reusableFixture(t);
  const bytes = zlib.gunzipSync(fs.readFileSync(ctx.har));
  const corrupt = Buffer.from(bytes);
  corrupt[0] ^= 1;
  fs.writeFileSync(ctx.har, zlib.gzipSync(corrupt));
  assert.throws(() => harInventory(ctx.har), /checksum/);
  fs.writeFileSync(ctx.har, zlib.gzipSync(bytes.subarray(0, 700)));
  assert.throws(() => harInventory(ctx.har), /Truncated/);
});

test('HAR inventory rejects symlink members rather than following them', (t) => {
  const { ctx } = reusableFixture(t);
  mutateHarHeader(ctx, (header) => {
    header[156] = 50;
  });
  assert.throws(() => harInventory(ctx.har), /Unsupported HAR member type/);
});

test('HAR inventory rejects path traversal and Windows path aliases', (t) => {
  for (const name of ['package/../escape', 'package/a:b', 'package/a\\b']) {
    const { ctx } = reusableFixture(t);
    mutateHarHeader(ctx, (header) => {
      header.fill(0, 0, 100);
      header.write(name, 0, 'utf8');
    });
    assert.throws(() => harInventory(ctx.har), /Unsafe HAR member path/);
  }
});

test('HAR inventory rejects duplicate members including case-only collisions', (t) => {
  for (const upperCase of [false, true]) {
    const { ctx } = reusableFixture(t);
    const bytes = zlib.gunzipSync(fs.readFileSync(ctx.har));
    const { offset, next } = firstTarFile(bytes);
    const duplicate = Buffer.from(bytes.subarray(offset, next));
    if (upperCase) {
      const name = duplicate
        .subarray(0, 100)
        .toString('utf8')
        .replace(/\0.*$/, '');
      duplicate.fill(0, 0, 100);
      duplicate.write(
        `package/${name.slice('package/'.length).toUpperCase()}`,
        0,
        'utf8'
      );
      updateTarChecksum(duplicate.subarray(0, 512));
    }
    fs.writeFileSync(
      ctx.har,
      zlib.gzipSync(
        Buffer.concat([
          bytes.subarray(0, offset),
          duplicate,
          bytes.subarray(offset),
        ])
      )
    );
    assert.throws(() => harInventory(ctx.har), /Duplicate HAR member path/);
  }
});

test('full test proof binds candidate, HAP and fresh complete results and rejects input drift', (t) => {
  const { ctx } = fixture(t);
  main(['build'], ctx);
  ctx.env.HDC_TARGET = ' explicit-target ';
  ctx.run = () => ({ status: 0, stdout: '[Info]App installed successfully.' });
  main(['install'], ctx);
  put(path.join(ctx.e2eRoot, 'node_modules', 'jest', 'bin', 'jest.js'));
  const report = {
    success: true,
    wasInterrupted: false,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    numFailedTestSuites: 0,
    numPendingTestSuites: 0,
    numPassedTestSuites: 2,
    numTotalTestSuites: 2,
    numPassedTests: 9,
    numTotalTests: 9,
    testResults: Object.entries(REQUIRED_HARMONY_TESTS).map(
      ([name, titles]) => ({
        name: path.join(ctx.e2eRoot, 'e2e', 'harmony', name),
        status: 'passed',
        assertionResults: titles.map((title) => ({ title, status: 'passed' })),
      })
    ),
  };
  const writeResults = (_command, args, options) => {
    assert.deepEqual(args.slice(1, 5), [
      '--config',
      'e2e/harmony.jest.config.js',
      '--runInBand',
      '--json',
    ]);
    assert.equal(options.env.HDC_TARGET, 'explicit-target');
    put(args[args.indexOf('--outputFile') + 1], JSON.stringify(report));
  };
  ctx.run = writeResults;
  main(['test'], ctx);
  const file = path.join(ctx.artifacts, 'harmony-test-inputs.json');
  const proof = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(proof.candidateSha256, ctx.env.RNU_HARMONY_SDK_SHA256);
  assert.equal(proof.build.candidateSha256, proof.candidateSha256);
  assert.equal(proof.hap.sha256, proof.build.hapSha256);
  assert.deepEqual(proof.passed, { suites: 2, passed: 9, skipped: 0 });
  ctx.run = () => ({});
  assert.throws(() => main(['test'], ctx), /nonempty file is missing/);
  assert.equal(fs.existsSync(file), false);
  ctx.run = (...args) => {
    writeResults(...args);
    put(path.join(ctx.artifacts, 'v1.ppk'), 'concurrent drift');
  };
  assert.throws(() => main(['test'], ctx), /inputs changed during/);
  assert.equal(fs.existsSync(file), false);
});
