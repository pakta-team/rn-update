#!/usr/bin/env node
/**
 * [INPUT]: 依赖显式候选 tgz/HAR 摘要、依赖/ZIP/结果门卫、DevEco、Harmony 工程、hdc 目标与既有 prepare/WSL/Jest 入口
 * [OUTPUT]: 提供分阶段 Harmony 命令、真实差分门禁及候选/HAR/base/HAP/设备身份与通过证明；独立原生 runner 复用隔离上下文
 * [POS]: e2etest 跨平台 Harmony 编排层；物理隔离候选避免根 RN 污染，构建与设备入口共用，不持有签名或实现更新逻辑
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const {
  hash,
  requireFile,
  assertDigest,
  sourceFiles,
  assertSource,
  assertLocalSdk,
  syncSdk,
  stageSdk,
} = require('./harmony-e2e-sdk');
const { assertReusableDependencies } = require('./harmony-e2e-inputs');
const { verifyArtifactSetSync } = require('./verify-update-artifacts');
const {
  assertHdcInstallSuccess,
  assertHarmonyTestResults,
} = require('./harmony-e2e-results');

const PHASES = [
  'stage',
  'sync',
  'prepare',
  'base',
  'build',
  'diff',
  'install',
  'test',
  'check',
  'all',
];
const REQUIRED_ARTIFACTS = [
  'v1.ppk',
  'v2.ppk',
  'v4.ppk',
  'v1-to-v2.ppk.patch',
  'to-v4.v2track.ppk.patch',
];

function context(env = process.env, overrides = {}) {
  const e2eRoot = overrides.e2eRoot || path.resolve(__dirname, '..');
  const sdkRoot = overrides.sdkRoot || path.resolve(e2eRoot, '../..');
  const appRoot =
    overrides.appRoot || path.resolve(e2eRoot, '../harmony_use_pakta');
  return {
    e2eRoot,
    sdkRoot,
    appRoot,
    project: path.resolve(
      env.RNU_HARMONY_PROJECT || path.join(appRoot, 'harmony')
    ),
    artifacts:
      overrides.artifacts || path.join(e2eRoot, '.e2e-artifacts', 'harmony'),
    bundleEntry: overrides.bundleEntry || 'e2e/entry.base.ts',
    installedSdk: path.join(appRoot, 'node_modules', 'rn-update'),
    har: path.resolve(
      env.RNU_HARMONY_HAR_PATH || path.join(sdkRoot, 'harmony', 'pakta.har')
    ),
    env: {
      ...env,
      E2E_PLATFORM: 'harmony',
      RNU_METRO_MAX_WORKERS: env.RNU_METRO_MAX_WORKERS || '2',
    },
    platform: overrides.platform || process.platform,
    run: overrides.run || run,
  };
}

function run(command, args, options = {}) {
  console.log(`Harmony E2E: ${options.label || path.basename(command)}`);
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
    throw new Error(
      `${options.label || command} exited ${result.status ?? result.signal}${output ? `: ${output}` : ''}`
    );
  }
  return result;
}

function assertArtifacts(ctx, real = true) {
  const manifest = JSON.parse(
    fs.readFileSync(
      requireFile(path.join(ctx.artifacts, 'manifest.json')),
      'utf8'
    )
  );
  if (manifest.platform !== 'harmony')
    throw new Error('Artifact manifest must identify harmony');
  if (real && manifest.fullFallback !== false)
    throw new Error(
      'Real Harmony diff proof requires manifest.fullFallback === false'
    );
  for (const file of real ? REQUIRED_ARTIFACTS : ['v1.ppk', 'v2.ppk', 'v4.ppk'])
    requireFile(path.join(ctx.artifacts, file));
  verifyArtifactSetSync(ctx.artifacts, 'harmony', real);
  return manifest;
}

function tools(ctx) {
  const roots = [
    ctx.env.DEVECO_STUDIO_HOME,
    ctx.env.DEVECO_HOME,
    'C:/Program Files/Huawei/DevEco Studio Release',
    'C:/Program Files/Huawei/DevEco Studio',
    '/Applications/DevEco-Studio.app/Contents',
  ].filter(Boolean);
  const home = roots.find((root) =>
    fs.existsSync(path.join(root, 'tools', 'hvigor', 'bin', 'hvigorw.js'))
  );
  if (!home) throw new Error('Set DEVECO_STUDIO_HOME to a DevEco installation');
  const sdk = ctx.env.DEVECO_SDK_HOME || path.join(home, 'sdk');
  const node =
    [
      ctx.env.HVIGOR_NODE_PATH,
      path.join(home, 'tools', 'node', 'node.exe'),
      path.join(home, 'tools', 'node', 'bin', 'node.exe'),
      path.join(home, 'tools', 'node', 'bin', 'node'),
    ].find((file) => file && fs.existsSync(file)) || process.execPath;
  const hdc =
    ctx.env.HDC_PATH ||
    path.join(
      sdk,
      'default',
      'openharmony',
      'toolchains',
      ctx.platform === 'win32' ? 'hdc.exe' : 'hdc'
    );
  return {
    node,
    hdc,
    hvigor: path.join(home, 'tools', 'hvigor', 'bin', 'hvigorw.js'),
    ohpm: path.join(home, 'tools', 'ohpm', 'bin', 'pm-cli.js'),
    env: { ...ctx.env, DEVECO_STUDIO_HOME: home, DEVECO_SDK_HOME: sdk },
  };
}

function assertProject(ctx) {
  if (ctx.platform === 'win32' && !ctx.env.RNU_HARMONY_PROJECT)
    throw new Error('Windows requires an explicit short RNU_HARMONY_PROJECT');
  requireFile(path.join(ctx.project, 'hvigorfile.ts'));
  const profile = fs.readFileSync(
    requireFile(path.join(ctx.project, 'entry', 'build-profile.json5')),
    'utf8'
  );
  const abi =
    profile.match(/(?:"abiFilters"|abiFilters)\s*:\s*\[([^\]]+)\]/)?.[1] || '';
  if (!abi.includes('arm64-v8a') || !abi.includes('x86_64'))
    throw new Error(
      'Harmony E2E requires both arm64-v8a and x86_64 ABI filters'
    );
}

function base(ctx) {
  if (
    !['e2e/entry.base.ts', 'e2e/entry.crashprobe.ts'].includes(ctx.bundleEntry)
  )
    throw new Error('Unknown Harmony validation bundle entry');
  syncSdk(ctx);
  assertArtifacts(ctx, false);
  assertProject(ctx);
  assertDigest(ctx.har, ctx.env.RNU_HARMONY_HAR_SHA256, 'HAR candidate');
  const cli = requireFile(
    path.join(ctx.appRoot, 'node_modules', 'react-native', 'cli.js')
  );
  ctx.run(
    process.execPath,
    [cli, 'bundle-harmony', '--dev', 'false', '--entry-file', ctx.bundleEntry],
    {
      cwd: ctx.appRoot,
      env: ctx.env,
      label: `Bundle ${ctx.bundleEntry} after artifact preparation`,
    }
  );
  const rawfile = path.join(
    ctx.appRoot,
    'harmony',
    'entry',
    'src',
    'main',
    'resources',
    'rawfile'
  );
  requireFile(path.join(rawfile, 'bundle.harmony.js'));
  if (
    fs.realpathSync(ctx.project) !==
    fs.realpathSync(path.join(ctx.appRoot, 'harmony'))
  ) {
    fs.cpSync(
      rawfile,
      path.join(ctx.project, 'entry', 'src', 'main', 'resources', 'rawfile'),
      { recursive: true }
    );
    fs.copyFileSync(ctx.har, path.join(ctx.project, 'pakta.har'));
    fs.copyFileSync(
      path.join(ctx.sdkRoot, 'harmony', 'hvigor-plugin.ts'),
      path.join(ctx.project, 'pakta-hvigor-plugin.ts')
    );
    const packageFile = path.join(ctx.project, 'entry', 'oh-package.json5');
    const packageSource = fs.readFileSync(packageFile, 'utf8');
    if (
      !/(?:pakta|["']pakta["'])\s*:\s*["']file:[^"']+["']/.test(packageSource)
    )
      throw new Error('Cannot locate short-project HAR dependency');
    fs.writeFileSync(
      packageFile,
      packageSource.replace(
        /((?:pakta|["']pakta["'])\s*:\s*)["']file:[^"']+["']/,
        "$1'file:../pakta.har'"
      )
    );
    const pluginFile = path.join(ctx.project, 'entry', 'hvigorfile.ts');
    const pluginSource = fs.readFileSync(pluginFile, 'utf8');
    if (!/from\s+["'][^"']*hvigor-plugin["']/.test(pluginSource))
      throw new Error('Cannot locate short-project Hvigor plugin import');
    fs.writeFileSync(
      pluginFile,
      pluginSource.replace(
        /from\s+["'][^"']*hvigor-plugin["']/,
        "from '../pakta-hvigor-plugin'"
      )
    );
    const cmakeFile = path.join(
      ctx.project,
      'entry',
      'src',
      'main',
      'cpp',
      'CMakeLists.txt'
    );
    const cmakeSource = fs.readFileSync(cmakeFile, 'utf8');
    const nativeRoot = path
      .join(ctx.sdkRoot, 'harmony', 'pakta', 'src', 'main', 'cpp')
      .replaceAll(path.sep, '/');
    requireFile(path.join(nativeRoot, 'PaktaTurboModule.cpp'));
    if (!/set\(PAKTA_CPP_DIR\s+"[^"]+"\)/.test(cmakeSource))
      throw new Error('Cannot locate short-project PAKTA_CPP_DIR');
    fs.writeFileSync(
      cmakeFile,
      cmakeSource.replace(
        /set\(PAKTA_CPP_DIR\s+"[^"]+"\)/,
        `set(PAKTA_CPP_DIR "${nativeRoot}")`
      )
    );
  }
}

function removeGeneratedDependencies(project) {
  const root = fs.realpathSync(project);
  const targets = ['oh_modules', path.join('entry', 'oh_modules')].map((name) =>
    path.join(root, name)
  );
  for (const target of targets) {
    if (
      fs.existsSync(target) &&
      !fs.realpathSync(target).startsWith(`${root}${path.sep}`)
    )
      throw new Error(
        `Refusing generated dependency cleanup outside project: ${target}`
      );
  }
  for (const target of targets)
    fs.rmSync(target, { recursive: true, force: true });
}

function build(ctx) {
  assertProject(ctx);
  assertLocalSdk(ctx);
  assertDigest(ctx.har, ctx.env.RNU_HARMONY_HAR_SHA256, 'HAR candidate');
  if (path.resolve(ctx.project) !== path.resolve(ctx.appRoot, 'harmony'))
    assertDigest(
      path.join(ctx.project, 'pakta.har'),
      ctx.env.RNU_HARMONY_HAR_SHA256,
      'Staged HAR candidate'
    );
  const inputs = buildInputs(ctx);
  const tool = tools(ctx);
  const env = {
    ...tool.env,
    NODE_OPTIONS: ctx.env.NODE_OPTIONS || '--max-old-space-size=2048',
    NINJAFLAGS: ctx.env.NINJAFLAGS || '-j1',
    CMAKE_BUILD_PARALLEL_LEVEL: ctx.env.CMAKE_BUILD_PARALLEL_LEVEL || '1',
  };
  const reuse = ctx.env.RNU_HARMONY_REUSE_DEPENDENCIES;
  if (reuse && reuse !== '0' && reuse !== '1')
    throw new Error('RNU_HARMONY_REUSE_DEPENDENCIES must be 0 or 1');
  if (reuse === '1') {
    const proof = assertReusableDependencies(ctx);
    console.log(
      `Harmony E2E: Reuse exact HAR dependency (${proof.files} files)`
    );
  } else {
    requireFile(tool.ohpm);
    removeGeneratedDependencies(ctx.project);
    ctx.run(tool.node, [tool.ohpm, 'install', '--all'], {
      cwd: ctx.project,
      env,
      label: 'Refresh exact HAR dependency',
    });
  }
  ctx.run(
    tool.node,
    [
      tool.hvigor,
      '--mode',
      'module',
      '-p',
      'module=entry@default',
      '-p',
      'product=default',
      '-p',
      'buildMode=release',
      'assembleHap',
      '--no-daemon',
    ],
    { cwd: ctx.project, env, label: 'Build dual-ABI release HAP' }
  );
  requireFile(hapPath(ctx));
  fs.mkdirSync(ctx.artifacts, { recursive: true });
  fs.writeFileSync(
    path.join(ctx.artifacts, 'harmony-build-inputs.json'),
    `${JSON.stringify({ ...inputs, hapSha256: hash(hapPath(ctx)) }, null, 2)}\n`
  );
}

function hapPath(ctx) {
  return path.join(
    ctx.project,
    'entry',
    'build',
    'default',
    'outputs',
    'default',
    'entry-default-signed.hap'
  );
}

function buildInputs(ctx) {
  if (!ctx.env.RNU_HARMONY_SDK_TGZ)
    throw new Error(
      'Build/install/test requires an explicit SDK candidate tgz'
    );
  const nativeRoot = path.join(
    ctx.sdkRoot,
    'harmony',
    'pakta',
    'src',
    'main',
    'cpp'
  );
  const cmakeDir = path.join(ctx.project, 'entry', 'src', 'main', 'cpp');
  const cmake = fs.readFileSync(
    requireFile(path.join(cmakeDir, 'CMakeLists.txt')),
    'utf8'
  );
  const configured = cmake.match(/set\(PAKTA_CPP_DIR\s+"([^"]+)"\)/)?.[1];
  const resolvedNative = configured
    ? path.resolve(
        cmakeDir,
        configured.replace(/\$\{CMAKE_CURRENT_SOURCE_DIR\}/, cmakeDir)
      )
    : '';
  if (
    !resolvedNative ||
    fs.realpathSync(resolvedNative) !== fs.realpathSync(nativeRoot)
  )
    throw new Error(
      'PAKTA_CPP_DIR must resolve to current SDK native glue; rerun base'
    );
  const plugin = path.join(ctx.sdkRoot, 'harmony', 'hvigor-plugin.ts');
  const stagedPlugin =
    path.resolve(ctx.project) === path.resolve(ctx.appRoot, 'harmony')
      ? plugin
      : path.join(ctx.project, 'pakta-hvigor-plugin.ts');
  const pluginSha256 = assertDigest(
    stagedPlugin,
    hash(requireFile(plugin)),
    'Staged Hvigor plugin'
  );
  const sources = sourceFiles(path.join(ctx.sdkRoot, 'src')).map((file) => [
    file,
    hash(path.join(ctx.sdkRoot, 'src', file)),
  ]);
  return {
    project: fs.realpathSync(ctx.project),
    ...(ctx.bundleEntry !== 'e2e/entry.base.ts'
      ? {
          fixtureBundleEntry: ctx.bundleEntry,
          fixtureEntrySha256: hash(
            requireFile(path.join(ctx.appRoot, ctx.bundleEntry))
          ),
        }
      : {}),
    candidateSha256: assertDigest(
      ctx.env.RNU_HARMONY_SDK_TGZ,
      ctx.env.RNU_HARMONY_SDK_SHA256,
      'SDK candidate'
    ),
    sdkSourcesSha256: crypto
      .createHash('sha256')
      .update(JSON.stringify(sources))
      .digest('hex'),
    harSha256: assertDigest(
      ctx.har,
      ctx.env.RNU_HARMONY_HAR_SHA256,
      'HAR candidate'
    ),
    pluginSha256,
    nativeGlueSha256: crypto
      .createHash('sha256')
      .update(
        JSON.stringify(
          fs
            .readdirSync(nativeRoot)
            .filter((file) => /\.(?:cpp|h|inc)$/.test(file))
            .sort()
            .map((file) => [file, hash(path.join(nativeRoot, file))])
        )
      )
      .digest('hex'),
    baseBundleSha256: hash(
      requireFile(
        path.join(
          ctx.project,
          'entry',
          'src',
          'main',
          'resources',
          'rawfile',
          'bundle.harmony.js'
        )
      )
    ),
  };
}

function assertBuild(ctx) {
  const recorded = JSON.parse(
    fs.readFileSync(
      requireFile(path.join(ctx.artifacts, 'harmony-build-inputs.json')),
      'utf8'
    )
  );
  const current = {
    ...buildInputs(ctx),
    hapSha256: hash(requireFile(hapPath(ctx))),
  };
  if (JSON.stringify(recorded) !== JSON.stringify(current))
    throw new Error(
      'Signed HAP/build inputs changed; rerun base/build before installing or testing'
    );
  return current;
}

function diff(ctx) {
  const manifest = assertArtifacts(ctx, false);
  if (manifest.fullFallback === false) {
    assertArtifacts(ctx);
    return;
  }
  const generator = path.join(__dirname, 'generate-platform-diffs-wsl.cjs');
  const cliRoot = ctx.env.RNU_WSL_CLI_ROOT;
  const hdiffRoot = ctx.env.RNU_WSL_HDIFF_ROOT;
  if (!cliRoot || !hdiffRoot)
    throw new Error(
      'diff requires RNU_WSL_CLI_ROOT and RNU_WSL_HDIFF_ROOT (native Linux paths on Linux/macOS)'
    );
  if (ctx.platform === 'win32') {
    const prefix = ctx.env.RNU_WSL_DISTRO
      ? ['--distribution', ctx.env.RNU_WSL_DISTRO, '--exec']
      : ['--exec'];
    const linuxPath = (file) => {
      const result = spawnSync(
        'wsl.exe',
        [...prefix, 'wslpath', '-a', '-u', file],
        { encoding: 'utf8' }
      );
      if (result.status !== 0)
        throw new Error(`WSL path conversion failed: ${file}`);
      return result.stdout.trim();
    };
    ctx.run(
      'wsl.exe',
      [
        ...prefix,
        'env',
        `RNU_WSL_CLI_ROOT=${cliRoot}`,
        `RNU_WSL_HDIFF_ROOT=${hdiffRoot}`,
        'RNU_WSL_PLATFORM=harmony',
        `RNU_WSL_ARTIFACT_DIR=${linuxPath(ctx.artifacts)}`,
        ctx.env.RNU_WSL_NODE || 'node',
        linuxPath(generator),
      ],
      { env: ctx.env, label: 'Generate real Harmony patches through WSL' }
    );
  } else {
    ctx.run(process.execPath, [generator], {
      env: {
        ...ctx.env,
        RNU_WSL_PLATFORM: 'harmony',
        RNU_WSL_ARTIFACT_DIR: ctx.artifacts,
      },
      label: 'Generate real Harmony patches',
    });
  }
  assertArtifacts(ctx);
}

function deviceArgs(ctx) {
  if (!ctx.env.HDC_TARGET?.trim())
    throw new Error(
      'HDC_TARGET is required; never select the first connected device'
    );
  return ['-t', ctx.env.HDC_TARGET.trim()];
}

function install(ctx) {
  const target = deviceArgs(ctx);
  const proof = assertBuild(ctx);
  const tool = tools(ctx);
  requireFile(hapPath(ctx));
  const result = ctx.run(tool.hdc, [...target, 'install', '-r', hapPath(ctx)], {
    env: tool.env,
    encoding: 'utf8',
    stdio: 'pipe',
    label: `Install HAP on ${ctx.env.HDC_TARGET}`,
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  console.log(output);
  assertHdcInstallSuccess(output);
  fs.writeFileSync(
    path.join(ctx.artifacts, 'harmony-install-inputs.json'),
    `${JSON.stringify({ target: target[1], hapSha256: proof.hapSha256, candidateSha256: proof.candidateSha256 }, null, 2)}\n`
  );
}

function check(ctx) {
  const sdk = assertLocalSdk(ctx);
  const manifest = assertArtifacts(ctx);
  const harSha256 = assertDigest(
    ctx.har,
    ctx.env.RNU_HARMONY_HAR_SHA256,
    'HAR candidate'
  );
  return {
    project: ctx.project,
    sdk,
    candidateSha256: ctx.env.RNU_HARMONY_SDK_TGZ
      ? assertDigest(
          ctx.env.RNU_HARMONY_SDK_TGZ,
          ctx.env.RNU_HARMONY_SDK_SHA256,
          'SDK candidate'
        )
      : null,
    harSha256,
    build: assertBuild(ctx),
    fullFallback: manifest.fullFallback,
    hap: fs.existsSync(hapPath(ctx))
      ? { path: hapPath(ctx), sha256: hash(hapPath(ctx)) }
      : null,
    artifacts: REQUIRED_ARTIFACTS.map((file) => ({
      file,
      sha256: hash(path.join(ctx.artifacts, file)),
    })),
  };
}

function testDevice(ctx, options = {}) {
  const target = deviceArgs(ctx);
  const report = check(ctx);
  const installed = JSON.parse(
    fs.readFileSync(
      requireFile(path.join(ctx.artifacts, 'harmony-install-inputs.json')),
      'utf8'
    )
  );
  if (
    installed.target !== target[1] ||
    installed.hapSha256 !== report.build.hapSha256 ||
    installed.candidateSha256 !== report.build.candidateSha256
  )
    throw new Error(
      'HAP was not installed by this run on HDC_TARGET; rerun install'
    );
  fs.writeFileSync(
    path.join(ctx.artifacts, 'harmony-run-inputs.json'),
    `${JSON.stringify(report, null, 2)}\n`
  );
  const tool = tools(ctx);
  const results = path.join(ctx.artifacts, 'harmony-jest-results.json');
  const success = path.join(ctx.artifacts, 'harmony-test-inputs.json');
  fs.rmSync(results, { force: true });
  fs.rmSync(success, { force: true });
  ctx.run(
    process.execPath,
    [
      require.resolve('jest/bin/jest', { paths: [ctx.e2eRoot] }),
      '--config',
      options.jestConfig || 'e2e/harmony.jest.config.js',
      '--runInBand',
      '--json',
      '--outputFile',
      results,
    ],
    {
      cwd: ctx.e2eRoot,
      env: {
        ...tool.env,
        HDC_PATH: tool.hdc,
        HDC_TARGET: target[1],
        RNU_E2E_SKIP_PREPARE: 'true',
        RNU_E2E_FULL_FALLBACK: 'false',
        ...options.env,
      },
      label: 'Run Harmony device E2E with real diff gate',
    }
  );
  const passed = (options.assertResults || assertHarmonyTestResults)(
    results,
    ctx.e2eRoot
  );
  if (JSON.stringify(check(ctx)) !== JSON.stringify(report))
    throw new Error('Harmony inputs changed during the full suite');
  fs.writeFileSync(
    success,
    `${JSON.stringify({ ...report, resultsSha256: hash(results), passed }, null, 2)}\n`
  );
}

function main(argv = process.argv.slice(2), ctx = context()) {
  const [phase = 'check', ...args] = argv;
  if (!PHASES.includes(phase))
    throw new Error(`Usage: run-harmony-e2e.js <${PHASES.join('|')}>`);
  if (args.length)
    throw new Error(
      'Harmony phases do not accept extra arguments; test always runs the full suite'
    );
  const prepare = () => {
    syncSdk(ctx);
    if (ctx.env.RNU_E2E_SKIP_PREPARE !== 'true')
      ctx.run(
        process.execPath,
        [path.join(__dirname, 'run-prepare-local-update-artifacts.js')],
        {
          cwd: ctx.e2eRoot,
          env: {
            ...ctx.env,
            RNU_E2E_FULL_FALLBACK: ctx.platform === 'win32' ? 'true' : 'false',
          },
          label: 'Prepare Harmony bundle/full inputs',
        }
      );
    assertArtifacts(ctx, false);
  };
  const actions = {
    stage: () => console.log(JSON.stringify(stageSdk(ctx), null, 2)),
    sync: () => syncSdk(ctx),
    prepare,
    base: () => base(ctx),
    build: () => build(ctx),
    diff: () => diff(ctx),
    install: () => install(ctx),
    test: () => testDevice(ctx),
    check: () => console.log(JSON.stringify(check(ctx), null, 2)),
  };
  if (phase === 'all')
    for (const step of ['prepare', 'base', 'build', 'diff', 'install', 'test'])
      actions[step]();
  else actions[phase]();
}

module.exports = {
  context,
  main,
  assertDigest,
  assertSource,
  assertLocalSdk,
  assertArtifacts,
  deviceArgs,
  removeGeneratedDependencies,
  check,
  testDevice,
};
if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
