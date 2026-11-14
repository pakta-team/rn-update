const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { sourceClosure, checkNativePacklist } = require('./package-source-closure');
const { readCandidate } = require('./package-candidate');

const root = path.resolve(__dirname, '..');

function candidateFixture(t, changes = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'pakta-closure-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const contents = Object.fromEntries(sourceClosure().map((file) =>
    [file, readFileSync(path.join(root, file))]));
  contents['package.json'] = readFileSync(path.join(root, 'package.json'));
  for (const [file, content] of Object.entries({ ...contents, ...changes })) {
    if (content === null) continue;
    const target = path.join(directory, 'package', file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  const tarball = path.join(directory, 'candidate.tgz');
  execFileSync('tar', ['-czf', tarball, '-C', directory, 'package']);
  return readCandidate(tarball);
}

test('candidate native closure is byte-identical without extracting or modifying checkout', (t) => {
  const candidate = candidateFixture(t);
  assert.deepEqual(checkNativePacklist(candidate.files, candidate), []);
});

for (const [file, suffix] of [
  ['android/jni/Android.mk', '\nLOCAL_SRC_FILES += missing_candidate.cpp\n'],
  ['harmony/pakta/src/main/cpp/CMakeLists.txt', '\ntarget_sources(pakta PRIVATE missing_candidate.cpp)\n'],
  ['rn-update.podspec', "\ns.source_files = 'missing_candidate.cpp'\n"],
  ['cpp/patch_core/install_record.cpp', '\n#include "missing_candidate.h"\n'],
  ['ios/RCTPakta/RCTPaktaRoundEngine.inc', '\n#include "missing_candidate.inc"\n'],
]) {
  test(`candidate-only build/include tampering fails: ${file}`, (t) => {
    const candidate = candidateFixture(t, {
      [file]: Buffer.concat([readFileSync(path.join(root, file)), Buffer.from(suffix)]),
    });
    assert.deepEqual(checkNativePacklist(candidate.files, candidate),
      [`candidate native source differs from checkout: ${file}`]);
    const result = spawnSync(process.execPath, [path.join(__dirname, 'check-packlist.js'),
      candidate.tarball, '--sha256', candidate.sha256], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert(result.stderr.includes(`candidate native source differs from checkout: ${file}`));
  });
}

test('candidate missing recursive include fails even while checkout contains it', (t) => {
  const file = 'android/jni/HDiffPatch/libHDiffPatch/HPatch/patch_private.h';
  const candidate = candidateFixture(t, { [file]: null });
  assert.deepEqual(checkNativePacklist(candidate.files, candidate),
    [`missing native source closure: ${file}`]);
  const result = spawnSync(process.execPath, [path.join(__dirname, 'check-packlist.js'),
    candidate.tarball], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert(result.stderr.includes(`missing native source closure: ${file}`));
});

test('candidate-only native source cannot introduce unchecked includes', (t) => {
  const file = 'ios/RCTPakta/CandidateOnly.mm';
  const candidate = candidateFixture(t, { [file]: '#include "absent.h"\n' });
  assert.deepEqual(checkNativePacklist(candidate.files, candidate),
    [`candidate native source differs from checkout: ${file}`]);
});

test('npm pack retains the native build and recursive local header closure', () => {
  const output = execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['pack', '--dry-run', '--ignore-scripts', '--json'], {
      cwd: root, encoding: 'utf8', shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const parsed = JSON.parse(output);
  const packed = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
  assert.deepEqual(checkNativePacklist(packed.files.map((file) => file.path)), []);
});

test('each native source or recursive header omission fails closed', () => {
  const closure = sourceClosure();
  for (const file of [
    'android/jni/HDiffPatch/decompress_plugin_demo.h',
    'android/jni/HDiffPatch/dirDiffPatch/dir_patch/dir_patch_types.h',
    'android/jni/HDiffPatch/libHDiffPatch/HPatch/patch_private.h',
    'android/jni/lzma/C/LzmaDec.c',
    'ios/RCTPakta/RCTPaktaRoundEngine.inc',
    'cpp/patch_core/install_record.cpp',
    'cpp/update_flow_core/round_engine.cpp',
  ]) assert(closure.includes(file), `closure must reach ${file}`);
  for (const file of closure) {
    assert.deepEqual(checkNativePacklist(closure.filter((entry) => entry !== file)),
      [`missing native source closure: ${file}`]);
  }
});

test('HDiff development projects and Python caches are rejected', () => {
  const closure = sourceClosure();
  for (const file of [
    'android/jni/HDiffPatch/builds/xcode/hdiffz.xcodeproj/project.pbxproj',
    'android/jni/HDiffPatch/builds/vc/HDiffZ.vcxproj',
    'android/jni/HDiffPatch/test/unit_test.cpp',
    'android/jni/HDiffPatch/libHDiffPatch/HDiff/diff.cpp',
    'android/jni/HDiffPatch/libParallel/parallel_import.cpp',
    'android/jni/HDiffPatch/dirDiffPatch/dir_diff/dir_diff.cpp',
    'ios/__pycache__/test.cpython-313.pyc',
  ]) assert.deepEqual(checkNativePacklist([...closure, file]),
    [`forbidden native development file: ${file}`]);
});
