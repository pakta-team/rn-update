import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const windows = process.platform === 'win32';
const nativeRoot = windows
  ? `/mnt/${root[0].toLowerCase()}${root.slice(2).replaceAll('\\', '/')}`
  : root;
function javascript(name: string) {
  const source = readFileSync(
    `${root}/harmony/pakta/src/main/ets/${name}.ts`,
    'utf8'
  )
    .replace(/^import[\s\S]*?;\r?\n/gm, '')
    .replace(/^export /gm, '');
  return new Bun.Transpiler({ loader: 'ts' }).transformSync(source);
}

describe('Harmony installation with real NAPI, shared core and filesystem', () => {
  test('runs the ArkTS adapters and download install path against the native core', () => {
    const build = spawnSync(
      windows ? 'wsl' : 'sh',
      windows
        ? [
            '-d',
            'Ubuntu',
            '--',
            'sh',
            `${nativeRoot}/harmony/pakta/src/test/test-install-napi.sh`,
          ]
        : [`${root}/harmony/pakta/src/test/test-install-napi.sh`],
      { encoding: 'utf8' }
    );
    expect(build.status, build.stderr).toBe(0);
    const script = `
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const vm = require('node:vm');
const native = require(${JSON.stringify(`${nativeRoot}/.tmp/harmony-install-tests/install.node`)});
const dir = fs.mkdtempSync(os.tmpdir() + '/pakta-harmony-install-');
let checks = 0;
function check(fn) { fn(); checks++; }
const error = (code, message) => Object.assign(new Error('[' + code + '] ' + message), { code });
const context = { NativePatchCore: native, ERROR_SWITCH_VERSION_FAILED: 'SWITCH_VERSION_FAILED', createUpdateError: error };
const install = vm.runInNewContext(${JSON.stringify(javascript('InstallRecord'))} + '\\n({parseInstallRecord, readInstallRecord, buildInstallRecord, writeInstallRecord, isInstallComplete, isRecordForVersion, verifyInstallForActivation, assertInstallActivationUnchanged, isReservedEntryName})', context);
const archive = vm.runInNewContext(${JSON.stringify(javascript('ArchiveLimits'))} + '\\n({checkUncompressedSize, measureExtractedDirectory})', context);
const DownloadTask = vm.runInNewContext(${JSON.stringify(javascript('DownloadTask'))} + '\\nDownloadTask', {
  ...context, fileIo: { accessSync: fs.existsSync, stat: async p => fs.statSync(p) },
  EventHub: {getInstance: () => ({})}, stagingDirectoryFor: p => p + '.staging',
  checkUncompressedSize: archive.checkUncompressedSize, measureExtractedDirectory: archive.measureExtractedDirectory,
  ensureFreeSpace: async () => {}, MAX_ARCHIVE_BYTES: 536870912,
  zlib: {getOriginalSize: async () => 6, decompressFile: async (_a, p) => fs.writeFileSync(p + '/bundle.harmony.js', 'bundle')},
});
const parseManifest = vm.runInNewContext(${JSON.stringify(javascript('DownloadTask'))} + '\\nparseManifestToArrays', context);
async function rejects(fn, pattern) { await assert.rejects(fn, pattern); checks++; }
const version = dir + '/abc', staging = version + '.staging', bundle = p => p + '/bundle.harmony.js';
async function main() {
  const normalize = vm.runInNewContext(${JSON.stringify(javascript('NativeUpdateConfig'))} + '\\nnormalizeNativeUpdateConfig', context);
  check(() => assert.equal(JSON.parse(normalize({appKey:'应用😀'})).appKey, '应用😀'));
  check(() => assert.equal(Object.hasOwn(JSON.parse(normalize({appKey:'a'})), 'channel'), false));
  for (const channel of ['default', 'override', null, undefined]) {
    check(() => assert.throws(() => normalize({appKey:'a', channel}), /Invalid native configuration: unknown option channel/));
  }
  check(() => assert.throws(() => native.normalizeConfiguration('{"appKey":"a","channel":null}'), /unknown option channel/));
  check(() => assert.throws(() => native.normalizeConfiguration('{}'), /appKey must be a string and must not be blank/));
  check(() => assert.throws(() => native.normalizeConfiguration('[]'), /expected an object/));
  check(() => assert.throws(() => native.normalizeConfiguration('{}', '{}'), /arguments/));
  const vectors = JSON.parse(fs.readFileSync(${JSON.stringify(`${nativeRoot}/cpp/update_flow_core/tests/round-engine-vectors.json`)},'utf8'));
  const expand = value => typeof value === 'string' && value.startsWith('@') ? vectors.fixtures[value.slice(1)]
    : Array.isArray(value) ? value.map(expand) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).map(([key,v]) => [key,expand(v)])) : value;
  const adapt = value => {
    if (typeof value === 'string' && /^[{[]/.test(value)) {
      try { return JSON.stringify(adapt(JSON.parse(value))); } catch (_) {}
    }
    if (Array.isArray(value)) return value.map(adapt);
    if (value && typeof value === 'object') {
      const result = {};
      for (const [key,v] of Object.entries(value)) {
        result[key] = adapt(v);
        if (key === 'packageVersion' && value.cInfo && value.channel === undefined) result.channel = 'default';
      }
      return result;
    }
    return value;
  };
  for (const round of vectors.rounds) {
    let state = '';
    for (const step of adapt(expand(round.steps))) {
      const result = JSON.parse(native.stepRound(state,JSON.stringify(step.event)));
      check(() => assert.deepEqual(result.commands,step.commands));
      state = JSON.stringify(result.state);
    }
  }
  check(() => assert.equal(native.runnableConfig(''),'{"status":"skipped","reason":"not_configured"}'));
  check(() => assert.equal(native.runnableConfig('{"appKey":" key "}'),''));
  check(() => assert.throws(() => native.stepRound('',{},'extra'), /arguments/));
  check(() => assert.equal(native.hostCancellation('{"appKey":"k"}','{"appKey":"k"}','{"appKey":"k"}',1,2,1,1),'config_changed'));
  fs.mkdirSync(staging);
  fs.writeFileSync(bundle(staging), 'bundle');
  const task = new DownloadTask({});
  const calls = [];
  task.assertInstallCurrent = () => calls.push('current');
  task.removeDirectory = async p => fs.rmSync(p, {recursive:true, force:true});
  await task.promoteStaging({unzipDirectory:version, hash:'abc'});
  check(() => assert.equal(calls.length, 2));
  check(() => assert.equal(fs.existsSync(staging), false));
  check(() => assert.equal(install.isInstallComplete(version, 'abc'), true));
  const record = install.readInstallRecord(version);
  check(() => assert.match(record.bundleSha256, /^[a-f0-9]{64}$/));
  check(() => assert.equal(install.isRecordForVersion(install.parseInstallRecord('{}'),'abc'),false));
  await install.writeInstallRecord(version,install.buildInstallRecord('abc',record.bundleSha256,''));
  await rejects(() => install.writeInstallRecord(version,'{}'), /FILE_OPERATION_FAILED/);
  const snapshot = await install.verifyInstallForActivation(version, 'abc', bundle(version));
  check(() => install.assertInstallActivationUnchanged(snapshot));
  check(() => assert.throws(() => native.installActivationUnchanged({}), /snapshot/));
  check(() => assert.throws(() => native.installSeal(staging, 'abc', '', 'extra'), /arguments/));
  check(() => assert.throws(() => native.installBuildRecord('abc', '', ''), /PATCH_FAILED/));
  fs.writeFileSync(bundle(version), 'tampered');
  check(() => assert.throws(() => install.assertInstallActivationUnchanged(snapshot), /SWITCH_VERSION_FAILED/));
  await rejects(() => install.verifyInstallForActivation(version,'abc',bundle(version)), /SWITCH_VERSION_FAILED/);
  for (const text of ['{}',' ','null','[]','{',JSON.stringify({schema:1,versionHash:'abc'}),JSON.stringify({schema:2,versionHash:'abc'})]) {
    fs.writeFileSync(version + '/.pakta-complete', text);
    await rejects(() => install.verifyInstallForActivation(version,'abc',bundle(version),true), /SWITCH_VERSION_FAILED/);
  }
  fs.writeFileSync(version + '/.pakta-complete','');
  check(() => assert.equal(install.isRecordForVersion(install.readInstallRecord(version),'abc'), true));
  const legacy = await install.verifyInstallForActivation(version,'abc',bundle(version));
  fs.writeFileSync(bundle(version),'legacy changed');
  check(() => assert.throws(() => install.assertInstallActivationUnchanged(legacy), /SWITCH_VERSION_FAILED/));
  fs.unlinkSync(version + '/.pakta-complete');
  await rejects(() => install.verifyInstallForActivation(version,'abc',bundle(version)), /SWITCH_VERSION_FAILED/);
  const grandfather = await install.verifyInstallForActivation(version,'abc',bundle(version),true);
  check(() => install.assertInstallActivationUnchanged(grandfather));
  fs.writeFileSync(version + '/.pakta-complete','{}');
  check(() => assert.throws(() => install.assertInstallActivationUnchanged(grandfather), /SWITCH_VERSION_FAILED/));
  for (const path of ['.pakta-complete','a/.pakta-x/b','a\\\\.pakta-x']) check(() => assert.equal(install.isReservedEntryName(path),true));
  for (const size of [NaN, Infinity, -1, 1.5, 9007199254740992]) check(() => assert.throws(() => archive.checkUncompressedSize(10,size), /PATCH_FAILED/));
  check(() => archive.checkUncompressedSize(20000,2000000));
  check(() => assert.throws(() => archive.checkUncompressedSize(19999,2000000), /PATCH_FAILED/));
  const extracted = dir + '/extracted'; fs.mkdirSync(extracted);
  fs.writeFileSync(extracted + '/ok', 'ok');
  await archive.measureExtractedDirectory(extracted, 100);
  fs.symlinkSync('/etc/passwd',extracted + '/link');
  await rejects(() => archive.measureExtractedDirectory(extracted,100), /PATCH_FAILED/);
  fs.unlinkSync(extracted + '/link'); fs.mkdirSync(extracted + '/.pakta-hidden');
  await rejects(() => archive.measureExtractedDirectory(extracted,100), /PATCH_FAILED/);
  const parse = (text, normalize=true) => JSON.parse(native.installParseManifest(text,normalize));
  const parsed = parse(JSON.stringify({copies:{'a':'resources/rawfile/a','b':''},copiesCrc:{a:0},hbcTransform:{'bundle.harmony.js.patch':{version:1}}}));
  check(() => assert.equal(parseManifest('{"copies":{"a":null}}',false).copyFroms[0],'a'));
  check(() => assert.throws(() => parseManifest('{"deletes":[1]}',false), /PATCH_FAILED/));
  check(() => assert.deepEqual(parsed.copyFroms,['a','b']));
  check(() => assert.deepEqual(parsed.copyCrcs,[0,null]));
  check(() => assert.deepEqual(JSON.parse(parsed.hbcTransformMeta),{version:1}));
  for (const value of [{copies:{a:4}},{copiesCrc:{a:-1}},{copiesCrc:{a:0.5}},{deletes:[1]},{copies:{'.pakta-complete':'x'}},{hbcTransform:{'bundle.harmony.js.patch':[]}}]) check(() => assert.throws(() => parse(JSON.stringify(value)), /PATCH_FAILED/));
  fs.mkdirSync(staging); fs.writeFileSync(bundle(staging),'new');
  await native.installSeal(staging,'abc','');
  check(() => assert.throws(() => native.installPromote(staging,version), /FILE_OPERATION_FAILED/));
  task.assertInstallCurrent = () => {throw new Error('stale')};
  await rejects(() => task.promoteStaging({unzipDirectory:version,hash:'abc'}), /stale/);
  task.assertInstallCurrent = () => {};
  await native.installSeal(version,'abc','');
  await task.promoteStaging({unzipDirectory:version,hash:'abc'});
  check(() => assert.equal(fs.existsSync(staging),false));
  fs.mkdirSync(staging); fs.writeFileSync(bundle(staging),'late');
  let guards = 0;
  task.assertInstallCurrent = () => {if (++guards === 2) throw new Error('stale after seal')};
  await rejects(() => task.promoteStaging({unzipDirectory:version,hash:'abc'}), /stale after seal/);
  check(() => assert.equal(fs.readFileSync(bundle(version),'utf8'),'legacy changed'));
  fs.rmSync(staging,{recursive:true}); fs.mkdirSync(staging);
  await rejects(() => native.installSeal(staging,'abc',''), /PATCH_FAILED/);
  check(() => assert.equal(fs.existsSync(staging + '/.pakta-complete'),false));
  const archiveFile = dir + '/archive'; fs.writeFileSync(archiveFile,'zip');
  fs.mkdirSync(dir + '/output');
  await task.extractArchive(archiveFile,dir + '/output');
  check(() => assert.equal(fs.readFileSync(bundle(dir + '/output'),'utf8'),'bundle'));
  console.log(JSON.stringify({checks}));
}
main().catch(e => {console.error(e); process.exitCode=1}).finally(() => fs.rmSync(dir,{recursive:true,force:true}));
`;
    const result = spawnSync(
      windows ? 'wsl' : 'node',
      windows ? ['-d', 'Ubuntu', '--', 'node'] : [],
      { encoding: 'utf8', input: script }
    );
    expect(result.status, result.stderr).toBe(0);
    const checks = JSON.parse(result.stdout.trim()).checks;
    expect(checks).toBeGreaterThanOrEqual(45);
    console.info(`Harmony real NAPI/core + ArkTS VM: ${checks} checks`);
  }, 120000);
});
