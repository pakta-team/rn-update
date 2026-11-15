/**
 * [INPUT]: 依赖 Node 测试/临时目录与 check-binary-strings 的扫描接口，读取四 ABI 发布库作为只读正控
 * [OUTPUT]: 对外提供合法身份与逐文件禁串、路径及缺失输入的正负控回归
 * [POS]: scripts 的二进制身份测试，所有突变只作用于临时副本，不写发布库
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { findWording, findBufferWording } = require('./check-binary-strings');

const script = path.join(__dirname, 'check-binary-strings.js');
const abis = ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64'];

function fixture(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pakta strings test '));
  try {
    return run(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function cli(files) {
  const result = spawnSync(process.execPath, [script, ...files], { encoding: 'utf8' });
  assert.ifError(result.error);
  return result;
}

test('保留 Pakta 身份、旧 JNI、协议与业务词，不豁免同串异源身份', () => {
  assert.deepEqual(findBufferWording(Buffer.from(
    'Pakta RCTPakta pakta::patch librnupdate.so cn/reactnative/modules/update\0' +
    'Java_cn_reactnative_modules_update_NativeInstall_execute\0' +
    'update patch rescue reload hotfix forceBootRescue crashRescue\0' +
    'https://cdn.jsdelivr.net/gh/pakta-team/rn-update@main/endpoints.json')), []);
  for (const token of ['Pushy', 'PUSHY', 'react-native-update', 'REACT-NATIVE-UPDATE']) {
    const run = `Pakta /build path/node_modules/${token}/native.cpp`;
    assert.deepEqual(findBufferWording(Buffer.from('\0' + run)), [run]);
  }
  assert.deepEqual(findBufferWording(Buffer.from('pus\0hy\xffreact-native-\0update')), []);
});

test('多文件数组保留带空格路径，并拒绝第二文件禁串', () => fixture(directory => {
  const first = path.join(directory, 'first clean.so');
  const second = path.join(directory, 'second dirty.so');
  fs.writeFileSync(first, 'Pakta');
  fs.writeFileSync(second, 'RCTPakta');
  assert.equal(cli([first, second]).status, 0);
  fs.appendFileSync(second, '\0React-Native-Update');
  const result = cli([first, second]);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes(second));
  assert.match(result.stderr, /forbidden wording/);
  assert.equal(cli([`${first} ${second}`]).status, 1);
}));

test('无输入、缺失、空文件及目录全部失败，失败后继续检查其他文件', () => fixture(directory => {
  assert.equal(cli([]).status, 2);
  const empty = path.join(directory, 'empty.so');
  const missing = path.join(directory, 'missing file.so');
  const dirty = path.join(directory, 'dirty file.so');
  fs.writeFileSync(empty, '');
  fs.writeFileSync(dirty, 'Pushy');
  assert.throws(() => findWording(empty), /empty binary/);
  assert.throws(() => findWording(directory), /not a regular/);
  const result = cli([missing, empty, directory, dirty]);
  assert.equal(result.status, 1);
  for (const file of [missing, empty, directory, dirty]) assert.ok(result.stderr.includes(file));
  assert.match(result.stderr, /empty binary/);
  assert.match(result.stderr, /forbidden wording/);
}));

test('真实四 ABI 通过同一禁串 CLI 且读取前后摘要不变', () => {
  const files = abis.map(abi => path.join(__dirname, '..', 'android/lib', abi, 'librnupdate.so'));
  const before = files.map(file => fs.readFileSync(file));
  const result = cli(files);
  assert.equal(result.status, 0, result.stderr);
  for (let i = 0; i < files.length; i++) assert.deepEqual(fs.readFileSync(files[i]), before[i]);
});

for (const abi of abis) {
  test(`Android verifier 拒绝 ${abi} 真实库追加禁串，空格路径不影响接线`, () => fixture(directory => {
    for (const name of abis) {
      fs.mkdirSync(path.join(directory, name));
      fs.copyFileSync(path.join(__dirname, '..', 'android/lib', name, 'librnupdate.so'),
        path.join(directory, name, 'librnupdate.so'));
    }
    const file = path.join(directory, abi, 'librnupdate.so');
    fs.appendFileSync(file, '\0Pakta Pushy forbidden\0');
    const result = spawnSync(process.execPath,
      [path.join(__dirname, 'verify-android-so.js'), directory], { encoding: 'utf8' });
    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.ok(result.stderr.includes(file));
    assert.match(result.stderr, /forbidden wording/);
    assert.doesNotMatch(result.stderr, /cannot read symbols|does not export/);
  }));
}
