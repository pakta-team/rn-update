#!/usr/bin/env node
/**
 * [INPUT]: 依赖固定 SDK/HAR、独立短工程、已经验真的 Harmony 制品及通用构建/安装/测试证明
 * [OUTPUT]: 提供 healthy/crash 两种独立原生设备验收，不覆盖原九项的工程或结果
 * [POS]: Harmony native forceBoot 与 JS 失效救援的编排入口；复用生产消费链，不写原生状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  context,
  main: platformMain,
  check,
  testDevice,
} = require('./run-harmony-e2e');
const { hash, requireFile } = require('./harmony-e2e-sdk');
const { TITLES, assertNativeResults } = require('./harmony-native-results');
const INPUTS = [
  'manifest.json',
  'v1.ppk',
  'v2.ppk',
  'v4.ppk',
  'v1-to-v2.ppk.patch',
  'to-v4.v2track.ppk.patch',
];

function nativeContext(variant, env = process.env, overrides = {}) {
  assert.ok(
    Object.hasOwn(TITLES, variant),
    'native variant must be healthy or crash'
  );
  assert.ok(
    env.RNU_HARMONY_PROJECT && env.RNU_HARMONY_NATIVE_PROJECT,
    'explicit original and native projects are required'
  );
  assert.notEqual(
    path.resolve(env.RNU_HARMONY_NATIVE_PROJECT),
    path.resolve(env.RNU_HARMONY_PROJECT),
    'native project must differ from the original nine-test project'
  );
  const original = context(env, overrides);
  const ctx = context(
    { ...env, RNU_HARMONY_PROJECT: env.RNU_HARMONY_NATIVE_PROJECT },
    {
      ...overrides,
      artifacts: path.join(
        original.e2eRoot,
        '.e2e-artifacts/harmony-native',
        variant
      ),
      bundleEntry:
        variant === 'crash' ? 'e2e/entry.crashprobe.ts' : 'e2e/entry.base.ts',
    }
  );
  assert.notEqual(
    path.resolve(ctx.project),
    path.resolve(ctx.appRoot, 'harmony'),
    'native validation requires a separate short project'
  );
  return { ctx, original };
}

function init(ctx, original) {
  const source = check(original);
  fs.mkdirSync(ctx.artifacts, { recursive: true });
  for (const file of INPUTS)
    fs.copyFileSync(
      requireFile(path.join(original.artifacts, file)),
      path.join(ctx.artifacts, file)
    );
  fs.writeFileSync(
    path.join(ctx.artifacts, 'native-fixture-inputs.json'),
    `${JSON.stringify(
      {
        sourceProject: original.project,
        sourceHapSha256: source.hap.sha256,
        inputs: INPUTS.map((file) => ({
          file,
          sha256: hash(path.join(ctx.artifacts, file)),
        })),
      },
      null,
      2
    )}\n`
  );
}

function assertFixture(ctx, original) {
  const proof = JSON.parse(
    fs.readFileSync(
      requireFile(path.join(ctx.artifacts, 'native-fixture-inputs.json')),
      'utf8'
    )
  );
  assert.deepEqual(
    proof.inputs.map((item) => item.file),
    INPUTS
  );
  for (const item of proof.inputs) {
    assert.equal(
      hash(requireFile(path.join(ctx.artifacts, item.file))),
      item.sha256,
      'native fixture drifted'
    );
    if (original)
      assert.equal(
        hash(requireFile(path.join(original.artifacts, item.file))),
        item.sha256,
        'served canonical fixture drifted'
      );
  }
}

function assertVariantBundle(ctx, variant) {
  const bundle = fs.readFileSync(
    requireFile(
      path.join(
        ctx.project,
        'entry/src/main/resources/rawfile/bundle.harmony.js'
      )
    )
  );
  assert.equal(
    bundle.includes(Buffer.from('HM_CRASH_PROBE: uncaught JS error at +1s')),
    variant === 'crash',
    'native HAP base bundle does not match the selected JS failure case; rerun base/build'
  );
}

function main(argv = process.argv.slice(2), env = process.env, overrides = {}) {
  const [variant, phase = 'check', ...extra] = argv;
  assert.equal(
    extra.length,
    0,
    'native phases do not accept filters or extra arguments'
  );
  assert.ok(
    ['init', 'base', 'build', 'install', 'test', 'check', 'all'].includes(
      phase
    ),
    'unknown native phase'
  );
  const { ctx, original } = nativeContext(variant, env, overrides);
  const perform = (step) => {
    if (step === 'init') return init(ctx, original);
    assertFixture(ctx, original);
    if (step !== 'base') assertVariantBundle(ctx, variant);
    if (step !== 'test') return platformMain([step], ctx);
    const runId = crypto.randomUUID();
    fs.rmSync(path.join(ctx.artifacts, 'harmony-native-observations.json'), {
      force: true,
    });
    testDevice(ctx, {
      jestConfig: 'e2e/harmony-native.jest.config.js',
      env: {
        RNU_HARMONY_NATIVE_VARIANT: variant,
        RNU_HARMONY_NATIVE_RUN_ID: runId,
        RNU_HARMONY_NATIVE_EVIDENCE_DIR: ctx.artifacts,
      },
      assertResults: (file, root) =>
        assertNativeResults(file, root, {
          runId,
          variant,
          target: ctx.env.HDC_TARGET.trim(),
          artifacts: ctx.artifacts,
        }),
    });
    assertFixture(ctx, original);
    const current = check(ctx);
    const archivedHap = path.join(ctx.artifacts, 'native-signed.hap');
    fs.copyFileSync(current.hap.path, archivedHap);
    assert.equal(hash(archivedHap), current.hap.sha256);
    fs.writeFileSync(
      path.join(ctx.artifacts, 'harmony-native-validation.json'),
      `${JSON.stringify(
        {
          variant,
          runId,
          bundleEntry: ctx.bundleEntry,
          archivedHap,
          archivedHapSha256: hash(archivedHap),
          testProofSha256: hash(
            path.join(ctx.artifacts, 'harmony-test-inputs.json')
          ),
        },
        null,
        2
      )}\n`
    );
  };
  if (phase === 'all')
    for (const step of ['init', 'base', 'build', 'install', 'test'])
      perform(step);
  else perform(phase);
}

module.exports = { nativeContext, assertFixture, assertVariantBundle, main };
if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
