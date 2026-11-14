/**
 * [INPUT]: 依赖显式候选 tgz 摘要、当前 SDK 生产源码与样例依赖树
 * [OUTPUT]: 提供候选物理隔离、生产源码逐字节核对及 React/RN/RNOH 本地解析守卫
 * [POS]: Harmony E2E 编排的依赖输入边界；不引入 SDK 根开发依赖，也不执行平台构建或设备命令
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');

function hash(file) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(file))
    .digest('hex');
}

function requireFile(file) {
  if (
    !fs.existsSync(file) ||
    !fs.statSync(file).isFile() ||
    fs.statSync(file).size === 0
  ) {
    throw new Error(`Required nonempty file is missing: ${file}`);
  }
  return file;
}

function assertDigest(file, expected, label) {
  requireFile(file);
  if (!/^[a-f0-9]{64}$/i.test(expected || ''))
    throw new Error(`${label} requires a full SHA256`);
  const actual = hash(file);
  if (actual !== expected.toLowerCase())
    throw new Error(`${label} SHA256 mismatch: ${actual}`);
  return actual;
}

function sourceFiles(root, relative = '') {
  return fs
    .readdirSync(path.join(root, relative), { withFileTypes: true })
    .flatMap((entry) => {
      if (entry.name === '__tests__') return [];
      const child = path.join(relative, entry.name);
      return entry.isDirectory()
        ? sourceFiles(root, child)
        : /\.(?:tsx?|jsx?|json)$/.test(child)
          ? [child]
          : [];
    })
    .sort();
}

function assertSource(candidate, sdkRoot) {
  const expectedRoot = path.join(sdkRoot, 'src');
  const actualRoot = path.join(candidate, 'src');
  const expected = sourceFiles(expectedRoot);
  const actual = sourceFiles(actualRoot);
  if (JSON.stringify(expected) !== JSON.stringify(actual))
    throw new Error(
      'Installed SDK production source inventory differs from current checkout'
    );
  for (const file of expected) {
    if (
      hash(path.join(expectedRoot, file)) !== hash(path.join(actualRoot, file))
    ) {
      throw new Error(
        `Installed SDK differs from current checkout: src/${file}`
      );
    }
  }
  return expected.length;
}

function assertLocalSdk(ctx) {
  requireFile(path.join(ctx.installedSdk, 'package.json'));
  const sampleModules = fs.realpathSync(path.join(ctx.appRoot, 'node_modules'));
  const resolvedSdk = fs.realpathSync(ctx.installedSdk);
  if (!resolvedSdk.startsWith(`${sampleModules}${path.sep}`))
    throw new Error(
      'SDK must be physically isolated inside sample node_modules; a workspace/root link is unsafe'
    );
  if (fs.existsSync(path.join(resolvedSdk, 'node_modules')))
    throw new Error(
      'Isolated SDK must not carry root devDependencies/node_modules'
    );
  const files = assertSource(resolvedSdk, ctx.sdkRoot);
  const appRequire = createRequire(path.join(ctx.appRoot, 'package.json'));
  const sdkRequire = createRequire(path.join(resolvedSdk, 'package.json'));
  const dependencies = {};
  for (const name of [
    'react',
    'react-native',
    '@react-native-oh/react-native-harmony',
  ]) {
    const appPath = fs.realpathSync(appRequire.resolve(`${name}/package.json`));
    const sdkPath = fs.realpathSync(sdkRequire.resolve(`${name}/package.json`));
    if (
      appPath !== sdkPath ||
      !appPath.startsWith(`${sampleModules}${path.sep}`)
    )
      throw new Error(
        `${name} resolves outside the Harmony sample dependency tree`
      );
    dependencies[name] = JSON.parse(fs.readFileSync(appPath, 'utf8')).version;
  }
  if (
    dependencies['react-native'] !== '0.72.5' ||
    dependencies['@react-native-oh/react-native-harmony'] !== '0.72.96' ||
    !dependencies.react.startsWith('18.')
  ) {
    throw new Error(
      `Unexpected Harmony dependency versions: ${JSON.stringify(dependencies)}`
    );
  }
  return { files, dependencies };
}

// ---------- 候选物理隔离：只替换已确认的样例受管包 ----------
function stageSdk(ctx) {
  const tgz = ctx.env.RNU_HARMONY_SDK_TGZ;
  if (!tgz)
    throw new Error(
      'stage requires RNU_HARMONY_SDK_TGZ and RNU_HARMONY_SDK_SHA256'
    );
  const sha256 = assertDigest(
    tgz,
    ctx.env.RNU_HARMONY_SDK_SHA256,
    'SDK candidate'
  );
  const staged = path.join(ctx.appRoot, '.local-sdk', 'rn-update.tgz');
  fs.mkdirSync(path.dirname(staged), { recursive: true });
  if (path.resolve(tgz) !== path.resolve(staged)) fs.copyFileSync(tgz, staged);
  assertDigest(staged, sha256, 'Staged SDK candidate');
  return { path: staged, sha256 };
}

function syncSdk(ctx) {
  const tgz = ctx.env.RNU_HARMONY_SDK_TGZ;
  if (!tgz) return assertLocalSdk(ctx);
  assertDigest(tgz, ctx.env.RNU_HARMONY_SDK_SHA256, 'SDK candidate');
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), 'pakta-harmony-sdk-')
  );
  try {
    ctx.run('tar', ['-xzf', path.resolve(tgz), '-C', temporary], {
      label: 'Extract explicit SDK candidate',
    });
    const extracted = path.join(temporary, 'package');
    requireFile(path.join(extracted, 'package.json'));
    if (fs.existsSync(path.join(extracted, 'node_modules')))
      throw new Error('SDK candidate contains node_modules');
    assertSource(extracted, ctx.sdkRoot);
    const modules = path.join(ctx.appRoot, 'node_modules');
    const realModules = fs.realpathSync(modules);
    if (
      path.dirname(ctx.installedSdk) !== modules ||
      path.basename(ctx.installedSdk) !== 'rn-update' ||
      !realModules.startsWith(`${fs.realpathSync(ctx.appRoot)}${path.sep}`)
    ) {
      throw new Error('Refusing to replace SDK outside sample node_modules');
    }
    const stat = fs.lstatSync(ctx.installedSdk, { throwIfNoEntry: false });
    if (stat) {
      if (stat.isSymbolicLink()) fs.unlinkSync(ctx.installedSdk);
      else fs.rmSync(ctx.installedSdk, { recursive: true, force: true });
    }
    fs.cpSync(extracted, ctx.installedSdk, {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
    return assertLocalSdk(ctx);
  } finally {
    // mkdtemp 返回的绝对路径属于本次进程，不依赖用户输入拼接清理目标。
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

module.exports = {
  hash,
  requireFile,
  assertDigest,
  sourceFiles,
  assertSource,
  assertLocalSdk,
  syncSdk,
  stageSdk,
};
