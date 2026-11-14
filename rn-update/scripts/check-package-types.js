#!/usr/bin/env node
/**
 * [INPUT]: 依赖 npm pack 生命周期、tar、TypeScript 与已安装消费依赖；候选路径和 --sha256 经共享身份闸门
 * [OUTPUT]: 解包真实候选包，守门旧桥 NativePaktaSpec.java 与 Harmony PaktaMethods.inc 非空存在，并在独立宿主验证公开 API 类型、错误输入拒绝及声明闭包
 * [POS]: scripts 的 npm 消费验收入口，不借用仓库 SDK 源码；生成绑定存在性不等于签名 parity 或原生编译，不执行原生构建或版本同步
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { readCandidate, candidateHash } = require('./package-candidate');

const root = path.resolve(__dirname, '..');
const { values, positionals } = parseArgs({
  allowPositionals: true, options: { sha256: { type: 'string' } },
});
assert(positionals.length <= 1 && (!values.sha256 || positionals.length === 1),
  'expected one candidate tgz for --sha256');
const supplied = positionals.length ? readCandidate(positionals[0], values.sha256) : null;
const host = mkdtempSync(path.join(os.tmpdir(), 'pakta-types-'));
const modules = path.join(host, 'node_modules');
mkdirSync(modules);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
let tarball = supplied && supplied.tarball;
if (!tarball) {
  execFileSync(npm, ['pack', '--json', '--pack-destination', host], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  const archives = readdirSync(host).filter((file) => file.endsWith('.tgz'));
  assert.equal(archives.length, 1);
  tarball = path.join(host, archives[0]);
}
const candidate = supplied || readCandidate(tarball);
const sdk = path.join(modules, 'rn-update');
mkdirSync(sdk);
execFileSync('tar', ['-xzf', tarball, '-C', sdk, '--strip-components=1']);
for (const entry of readdirSync(path.join(root, 'node_modules'))) {
  if (entry.startsWith('.') || entry === 'rn-update') continue;
  symlinkSync(
    path.join(root, 'node_modules', entry),
    path.join(modules, entry),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
}
const metadata = JSON.parse(
  readFileSync(path.join(sdk, 'package.json'), 'utf8')
);
assert.equal(metadata.types, 'dist/types/index.d.ts');
assert.equal(metadata.main, 'src/index');
assert.deepEqual(metadata.codegenConfig, {
  name: 'RCTPaktaSpec',
  type: 'modules',
  jsSrcsDir: 'src',
});
assert.equal(typeof require(path.join(sdk, 'app.plugin.js')), 'function');
for (const file of [
  'src/index.ts',
  'src/NativePakta.ts',
  'expo-module.config.json',
  'check-expo-version.js',
  'react-native.config.js',
  'rn-update.podspec',
  'android/build.gradle',
  'android/src/main/java/cn/reactnative/modules/update/UpdateContext.java',
  'android/src/oldarch/cn/reactnative/modules/update/NativePaktaSpec.java',
  'android/jni/hpatch.c',
  'ios/ImportReact.h',
  'ios/RCTPakta/RCTPakta.mm',
  'cpp/patch_core/patch_core.cpp',
  'cpp/update_flow_core/update_flow_core.cpp',
  'harmony/hvigor-plugin.ts',
  'harmony/pakta/src/main/ets/UpdateContext.ts',
  'harmony/pakta/src/main/cpp/PaktaMethods.inc',
]) {
  assert(readFileSync(path.join(sdk, file)).length > 0, `missing: ${file}`);
}
writeFileSync(
  path.join(host, 'consumer.tsx'),
  `import { Pakta, PaktaProvider, UpdateProvider, usePakta, useUpdate, useUpdateProgress, UpdateError, getUpdateMetadata, attachToSentry, attachToCrashlytics, PaktaModule, UpdateModule } from 'rn-update';
import type { ClientOptions, UpdateContextValue, ProgressData, CheckResult, UpdateErrorCode, UpdateMetadata, BeforeReloadContext } from 'rn-update';
const options: ClientOptions = { appKey: 'consumer', updateStrategy: 'silentAndNow' };
const client = new Pakta(options);
const result: Promise<CheckResult | undefined> = client.checkUpdate();
const provider = <PaktaProvider client={client}><UpdateProvider client={client}>{null}</UpdateProvider></PaktaProvider>;
const context: UpdateContextValue = useUpdate();
const alias: typeof useUpdate = usePakta;
const progress: ProgressData | undefined = useUpdateProgress();
const code: UpdateErrorCode = 'APPKEY_REQUIRED';
const error: Error = new UpdateError('consumer', code);
const metadata: UpdateMetadata = getUpdateMetadata();
const native: typeof PaktaModule = UpdateModule;
const beforeReload = (value: BeforeReloadContext) => value;
void [result, provider, context, alias, progress, error, metadata, native, beforeReload, attachToSentry, attachToCrashlytics];
`
);
const config = {
  compilerOptions: {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'bundler',
    jsx: 'react-jsx',
    types: ['react', 'react-native'],
    lib: ['ES2022'],
    esModuleInterop: true,
  },
  files: ['consumer.tsx'],
};
writeFileSync(path.join(host, 'tsconfig.json'), JSON.stringify(config));
const compilerPackage = require.resolve('typescript/package.json');
const compiler = path.resolve(
  path.dirname(compilerPackage),
  require(compilerPackage).bin.tsc
);
const files = execFileSync(
  process.execPath,
  [compiler, '-p', path.join(host, 'tsconfig.json'), '--listFiles'],
  { cwd: host, encoding: 'utf8' }
).split(/\r?\n/);
const sdkFiles = files.filter((file) =>
  file.replaceAll('\\', '/').includes('/node_modules/rn-update/')
);
assert(sdkFiles.some((file) => file.endsWith('/dist/types/index.d.ts')));
assert(sdkFiles.every((file) => file.endsWith('.d.ts')));
for (const file of readdirSync(path.join(sdk, 'dist/types'), {
  recursive: true,
})) {
  assert(file.endsWith('.d.ts') || !path.extname(file));
  if (!file.endsWith('.d.ts')) continue;
  const declaration = path.join(sdk, 'dist/types', file);
  const source = readFileSync(declaration, 'utf8');
  for (const match of source.matchAll(
    /(?:from\s+|import\s*\()['"](\.[^'"]+)['"]/g
  )) {
    const dependency = path.resolve(path.dirname(declaration), match[1]);
    assert(dependency.startsWith(path.join(sdk, 'dist/types') + path.sep));
    readFileSync(`${dependency}.d.ts`, 'utf8');
  }
}
writeFileSync(
  path.join(host, 'invalid.ts'),
  "import type { ClientOptions } from 'rn-update'; const options: ClientOptions = { appKey: 123 };"
);
config.files = ['invalid.ts'];
writeFileSync(path.join(host, 'tsconfig.json'), JSON.stringify(config));
const invalid = spawnSync(process.execPath, [compiler, '-p', host], {
  cwd: host,
  encoding: 'utf8',
});
assert.notEqual(invalid.status, 0);
assert.match(invalid.stdout + invalid.stderr, /TS2322/);
assert.equal(candidateHash(tarball), candidate.sha256, 'candidate changed during consumption');
console.log(`check-package-types: ${sdkFiles.length} SDK declarations OK`);
console.log(`candidate SHA-256: ${candidate.sha256}`);
console.log(`candidate tarball: ${tarball}`);
console.log(`consumer workspace: ${host}`);
