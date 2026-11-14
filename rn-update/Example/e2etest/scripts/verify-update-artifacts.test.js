/**
 * [INPUT]: 依赖 Node 测试/临时目录、冻结 ZIP 黄金夹具及真实生成/复用门卫入口
 * [OUTPUT]: 提供结构/CRC/预算/必需条目负控及生成失败不提交 false 的持久回归
 * [POS]: scripts 的制品真实性测试，只写系统 TEMP，不生成业务夹具或执行平台/设备
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const {
  verifyArtifactSet,
  verifyArtifactSetSync,
  verifyZip,
} = require('./verify-update-artifacts');
const fixtures = require('./zip-artifact-fixtures');
const { archiveLimits } = require('../../../scripts/contract.json');

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zip artifacts '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ['v1.ppk', 'v2.ppk', 'v4.ppk'])
    fs.writeFileSync(path.join(root, name), fixtures.full);
  for (const name of ['v1-to-v2.ppk.patch', 'to-v4.v2track.ppk.patch'])
    fs.writeFileSync(path.join(root, name), fixtures.patch);
  return root;
}
function central(bytes) {
  return bytes.indexOf(Buffer.from('504b0102', 'hex'));
}
async function rejects(t, change, pattern) {
  const root = setup(t);
  const bytes = Buffer.from(fixtures.patch);
  const changed = change(bytes) || bytes;
  const file = path.join(root, 'v1-to-v2.ppk.patch');
  fs.writeFileSync(file, changed);
  await assert.rejects(verifyZip(file, 'harmony', 'ppkPatch'), pattern);
}
test('stored and deflate/descriptor ZIPs pass async and synchronous full-set verification', async (t) => {
  const root = setup(t);
  fs.writeFileSync(
    path.join(root, 'to-v4.v2track.ppk.patch'),
    fixtures.descriptor
  );
  assert.equal((await verifyArtifactSet(root, 'harmony')).length, 5);
  assert.equal(
    verifyArtifactSetSync(root, 'harmony').every((item) => item.crcVerified),
    true
  );
});
test('missing 53-byte first header and local/central offset or size drift are refused', async (t) => {
  await rejects(t, (bytes) => bytes.subarray(53), /central|header|Entries/);
  await rejects(
    t,
    (bytes) => {
      bytes.writeUInt32LE(1, central(bytes) + 42);
    },
    /header/
  );
  await rejects(
    t,
    (bytes) => {
      bytes.writeUInt32LE(1, 18);
    },
    /sizes/
  );
  await rejects(
    t,
    (bytes) => {
      bytes[30] ^= 1;
    },
    /header/
  );
});
test('central span, EOCD trailing bytes and descriptor mismatch are refused', async (t) => {
  await rejects(
    t,
    (bytes) => {
      bytes.writeUInt32LE(1, bytes.length - 10);
    },
    /central/
  );
  await rejects(
    t,
    (bytes) => Buffer.concat([bytes, Buffer.from('junk')]),
    /central/
  );
  const root = setup(t);
  const bytes = Buffer.from(fixtures.descriptor);
  bytes[bytes.indexOf(Buffer.from('504b0708', 'hex')) + 4] ^= 1;
  const file = path.join(root, 'descriptor.zip');
  fs.writeFileSync(file, bytes);
  await assert.rejects(verifyZip(file, 'harmony', 'ppkPatch'), /descriptor/);
});
test('payload CRC corruption, missing required entries and invalid manifest shapes fail', async (t) => {
  await rejects(
    t,
    (bytes) => {
      bytes[53] ^= 1;
    },
    /CRC/
  );
  await rejects(
    t,
    (bytes) => {
      const from = Buffer.from('bundle.harmony.js.patch');
      let at = 0;
      while ((at = bytes.indexOf(from, at)) !== -1) {
        bytes.write('bundle.harmony.js.other', at);
        at += from.length;
      }
    },
    /required/
  );
  await rejects(
    t,
    (bytes) => {
      const from = Buffer.from('__diff.json');
      let at = 0;
      while ((at = bytes.indexOf(from, at)) !== -1) {
        bytes.write('__none.json', at);
        at += from.length;
      }
    },
    /__diff.json/
  );
  const root = setup(t);
  fs.writeFileSync(path.join(root, 'v1-to-v2.ppk.patch'), fixtures.badManifest);
  await assert.rejects(verifyArtifactSet(root, 'harmony'), /manifest shape/);
});
test('declared expansion and compression-ratio budgets reject before payload inflation', async (t) => {
  await rejects(
    t,
    (bytes) => {
      bytes.writeUInt32LE(archiveLimits.MaxEntryBytes + 1, central(bytes) + 24);
    },
    /budget/
  );
  await rejects(
    t,
    (bytes) => {
      bytes.writeUInt32LE(
        archiveLimits.RatioCheckMinBytes,
        central(bytes) + 24
      );
    },
    /budget/
  );
});
test('generator publishes false only after all ZIPs pass and invalidates old false on failure', (t) => {
  for (const corrupt of [false, true]) {
    const root = setup(t);
    const cli = path.join(root, 'cli');
    const hdiff = path.join(root, 'modules', 'node-hdiffpatch');
    fs.mkdirSync(path.join(cli, 'lib'), { recursive: true });
    fs.mkdirSync(hdiff, { recursive: true });
    fs.writeFileSync(path.join(cli, 'package.json'), '{"version":"1.1.0"}');
    fs.writeFileSync(
      path.join(hdiff, 'index.js'),
      'exports.diff=exports.patch=exports.diffStream=exports.patchStream=()=>{};'
    );
    const patch = corrupt ? fixtures.patch.subarray(53) : fixtures.patch;
    fs.writeFileSync(
      path.join(cli, 'lib', 'exports.js'),
      `const fs=require('fs'); const data=Buffer.from('${patch.toString('base64')}','base64'); exports.diffCommands={hdiff:async({options})=>fs.writeFileSync(options.output,data),hdiffFromApk:async()=>{}};`
    );
    const manifest = path.join(root, 'manifest.json');
    fs.writeFileSync(manifest, '{"platform":"harmony","fullFallback":false}');
    const result = spawnSync(
      process.execPath,
      [path.join(__dirname, 'generate-platform-diffs-wsl.cjs')],
      {
        env: {
          ...process.env,
          RNU_WSL_CLI_ROOT: cli,
          RNU_WSL_HDIFF_ROOT: path.dirname(hdiff),
          RNU_WSL_ARTIFACT_DIR: root,
          RNU_WSL_PLATFORM: 'harmony',
        },
        encoding: 'utf8',
      }
    );
    assert.equal(result.status, corrupt ? 1 : 0, result.stderr);
    assert.equal(JSON.parse(fs.readFileSync(manifest)).fullFallback, corrupt);
  }
});

test('entry count and total expansion budgets are independently enforced', async (t) => {
  const root = setup(t);
  for (const [name, value] of [
    ['MaxEntries', 1],
    ['MaxTotalUncompressedBytes', 20],
  ]) {
    const previous = archiveLimits[name];
    archiveLimits[name] = value;
    try {
      await assert.rejects(
        verifyZip(path.join(root, 'v1-to-v2.ppk.patch'), 'harmony', 'ppkPatch'),
        /budget/
      );
    } finally {
      archiveLimits[name] = previous;
    }
  }
});
