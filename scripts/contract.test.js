/**
 * [INPUT]: 依赖 Node 测试/断言、临时文件系统、真实 contract 生成器、schema 与目标分区
 * [OUTPUT]: 验证逐分区损坏修复、唯一所有权、非法事实拒绝、幂等、只读检查与分区外字节保护
 * [POS]: scripts 的 T08 独立回归层，破坏性负控仅作用于临时副本，生命周期事实不得参与生成
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { generate, planGeneration } = require('./generate-contract');
const { targets } = require('./contract-targets');
const { validateContract } = require('./contract-schema');
const contract = require('./contract.json');
const root = path.resolve(__dirname, '..');
const files = [...new Set(targets(contract).map(target => target.file))];

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pakta-contract-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const file of files) {
    const destination = path.join(directory, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(root, file), destination);
  }
  generate({ root: directory });
  return directory;
}

const snapshot = (directory) => files.map(file => [file, fs.readFileSync(path.join(directory, file), 'utf8'), fs.statSync(path.join(directory, file)).mtimeMs]);

test('checked-in declarations agree with contract and CLI --check', (t) => {
  assert.deepEqual(generate({ check: true }), []);
  const result = spawnSync(process.execPath, [path.join(__dirname, 'generate-contract.js'), '--check'], { encoding: 'utf8', cwd: os.tmpdir() });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /check passed/);
  const directory = fixture(t);
  for (const name of ['generate-contract.js', 'contract-schema.js', 'contract-targets.js', 'contract.json']) {
    fs.copyFileSync(path.join(__dirname, name), path.join(directory, 'scripts', name));
  }
  const endpoint = path.join(directory, 'src/endpoint.ts');
  fs.writeFileSync(endpoint, fs.readFileSync(endpoint, 'utf8').replace('MAX_ENDPOINT_REQUESTS = 8', 'MAX_ENDPOINT_REQUESTS = 9'));
  const before = snapshot(directory);
  const failed = spawnSync(process.execPath, [path.join(directory, 'scripts/generate-contract.js'), '--check'], { encoding: 'utf8' });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /contract drift:[\s\S]*src\/endpoint.ts/);
  assert.deepEqual(snapshot(directory), before);
});

test('generation is byte and mtime idempotent; --check is read-only', (t) => {
  const directory = fixture(t);
  const before = snapshot(directory);
  assert.deepEqual(generate({ root: directory }), []);
  assert.deepEqual(generate({ root: directory }), []);
  assert.deepEqual(generate({ root: directory, check: true }), []);
  assert.deepEqual(snapshot(directory), before);
});

test('every owned partition detects corruption without writes and can be repaired', (t) => {
  const directory = fixture(t);
  for (const partition of targets(contract)) {
    const file = path.join(directory, partition.file);
    const original = fs.readFileSync(file, 'utf8');
    const damaged = original.replace(partition.pattern, (match) => {
      const equals = match.indexOf('=') + 1;
      return match.slice(0, equals) + match.slice(equals).replace(/'[^']*'|"[^"]*"|\d+/, value => /^\d/.test(value) ? String(Number(value) + 1) : `${value.slice(0, -1)}_NEGATIVE${value.at(-1)}`);
    });
    assert.notEqual(damaged, original, `${partition.file}:${partition.owner}`);
    fs.writeFileSync(file, damaged);
    const before = snapshot(directory);
    assert.deepEqual(generate({ root: directory, check: true }), [partition.file]);
    assert.deepEqual(snapshot(directory), before);
    assert.deepEqual(generate({ root: directory }), [partition.file]);
    assert.equal(fs.readFileSync(file, 'utf8'), original);
  }
});

test('missing or duplicated ownership fails before any file is written', (t) => {
  const directory = fixture(t);
  const partition = targets(contract).at(-1);
  const file = path.join(directory, partition.file);
  const original = fs.readFileSync(file, 'utf8');
  for (const replacement of ['', `${partition.content}\n${partition.content}`]) {
    fs.writeFileSync(file, original.replace(partition.pattern, () => replacement));
    const before = snapshot(directory);
    assert.throws(() => generate({ root: directory }), /expected one owned declaration/);
    assert.deepEqual(snapshot(directory), before);
  }
});

test('unowned code, JNI signatures, cleanup, marker verification and CRLF are preserved', (t) => {
  const directory = fixture(t);
  for (const name of files) {
    const file = path.join(directory, name);
    const original = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, `\n${original.replace(/\r?\n/g, '\r\n')}\n`);
  }
  const before = snapshot(directory);
  assert.deepEqual(generate({ root: directory }), []);
  assert.deepEqual(snapshot(directory), before);
  const strip = (file, source) => {
    for (const partition of targets(contract).filter(target => target.file === file)) source = source.replace(partition.pattern, '');
    return source;
  };
  const changed = structuredClone(contract);
  changed.endpointBudget.maxRequests = 9;
  changed.archiveLimits.MaxEntryBytes += 1;
  changed.installRecord.Schema += 1;
  const plan = planGeneration(directory, changed);
  for (const [file, value] of plan) assert.equal(strip(file, value.generated), strip(file, value.original), file);
});

test('lifecycle facts never participate in generated production declarations', (t) => {
  const directory = fixture(t);
  const changed = structuredClone(contract);
  changed.lifecycle.android.reset = 'negative control: do not execute';
  assert.deepEqual(generate({ root: directory, contract: changed }), []);
  assert(targets(changed).every(target => !target.owner.includes('lifecycle')));
});

test('type partition tolerates semicolons in existing explanatory text', (t) => {
  const directory = fixture(t);
  const file = path.join(directory, 'src/error.ts');
  const original = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, original.replace("  | 'SINGLETON_VIOLATION'", "  /* existing explanation; not the type terminator */\n  | 'SINGLETON_VIOLATION'"));
  assert.deepEqual(generate({ root: directory }), ['src/error.ts']);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
});

test('ABI facts match the unchanged NDK build list', () => {
  const source = fs.readFileSync(path.join(root, 'android/jni/Application.mk'), 'utf8');
  const declared = source.match(/^APP_ABI\s*:=\s*(.*)$/m)[1].trim().split(/\s+/);
  assert.deepEqual(declared.sort(), contract.androidAbis.map(abi => abi.name).sort());
});

test('invalid contracts are rejected before IO', () => {
  const mutations = [
    value => { value.schema = 2; },
    value => { value.unowned = true; },
    value => { delete value.archiveLimits.MaxEntryBytes; },
    value => { value.archiveLimits.MaxEntryBytes = -1; },
    value => { value.archiveLimits.MaxEntryBytes = Number.MAX_SAFE_INTEGER + 1; },
    value => { value.stateOperations.Rollback = 1; },
    value => { value.taskTypes.PatchFull = 9; },
    value => { value.nativeErrors.InvalidOptions = 'bad"code'; },
    value => { value.jsErrors.pop(); },
    value => { value.jsErrors.push(value.jsErrors[0]); },
    value => { value.androidAbis.push(value.androidAbis[0]); },
    value => { value.androidAbis[0].name = '../escape'; },
    value => { value.androidAbis[0].minPageAlignment = 123; },
    value => { value.androidAbis[0].machine = 65536; },
    value => { value.endpointBudget.maxRequests = 0; },
    value => { value.installRecord.FileName = '../marker'; },
    value => { value.installRecord.StagingSuffix = "';evil"; },
    value => { value.lifecycle.mode = 'execute'; },
    value => { value.lifecycle.android.source = '../escape'; },
  ];
  for (const mutate of mutations) {
    const value = structuredClone(contract);
    mutate(value);
    assert.throws(() => validateContract(value));
    assert.throws(() => generate({ root: 'nonexistent-negative-control-root', contract: value }));
  }
});

test('CLI rejects unsupported arguments', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'generate-contract.js'), '--write-anywhere'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /usage:/);
});
