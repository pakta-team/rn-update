/**
 * [INPUT]: 依赖 Node test、tar 与临时候选归档，读取本仓库根目录的真实发布工作流
 * [OUTPUT]: 正控身份读取及错名/错版本/错摘要负控，约束检查消费发布同一路径与原权限
 * [POS]: scripts 的候选隔离回归，不调用发布或修改生产源码
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, linkSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { readCandidate, candidateHash } = require('./package-candidate');
const metadata = require('../package.json');

function fixture(overrides = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'pakta-candidate-test-'));
  mkdirSync(path.join(directory, 'package'));
  writeFileSync(path.join(directory, 'package/package.json'),
    JSON.stringify({ name: metadata.name, version: metadata.version, ...overrides }));
  const tarball = path.join(directory, 'candidate.tgz');
  execFileSync('tar', ['-czf', tarball, '-C', directory, 'package']);
  return tarball;
}

test('candidate identity and pinned SHA-256 positive control', () => {
  const tarball = fixture();
  const candidate = readCandidate(tarball, candidateHash(tarball));
  assert.deepEqual(candidate.files, ['package.json']);
  assert.equal(JSON.parse(candidate.readFile('package.json')).name, metadata.name);
  assert.throws(() => candidate.readFile('../package.json'), /missing candidate file/);
});

test('candidate hardlinks are rejected before reading file contents', () => {
  const tarball = fixture();
  const directory = path.dirname(tarball);
  linkSync(path.join(directory, 'package/package.json'), path.join(directory, 'package/linked.json'));
  execFileSync('tar', ['-czf', tarball, '-C', directory, 'package']);
  assert.throws(() => readCandidate(tarball), /non-regular candidate entry/);
});

for (const [field, value] of [['name', 'not-rn-update'], ['version', '0.0.0-invalid']]) {
  test(`candidate ${field} mismatch fails in both consumers`, () => {
    const tarball = fixture({ [field]: value });
    assert.throws(() => readCandidate(tarball), new RegExp(`candidate ${field} mismatch`));
    for (const script of ['check-packlist.js', 'check-package-types.js']) {
      const result = spawnSync(process.execPath, [path.join(__dirname, script), tarball], { encoding: 'utf8' });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, new RegExp(`candidate ${field} mismatch`));
    }
  });
}

test('candidate digest mismatch fails before check and consumption', () => {
  const tarball = fixture();
  for (const script of ['check-packlist.js', 'check-package-types.js']) {
    const result = spawnSync(process.execPath, [path.join(__dirname, script), tarball,
      '--sha256', '0'.repeat(64)], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /candidate SHA-256 mismatch/);
  }
});

test('release branches publish only the checked candidate with original permissions', () => {
  const workflow = readFileSync(path.join(__dirname, '../.github/workflows/publish.yml'), 'utf8');
  assert.match(workflow, /permissions:\r?\n  id-token: write[^\n]*\r?\n  contents: read/);
  assert.equal((workflow.match(/id: candidate/g) || []).length, 2);
  assert.equal((workflow.match(/sha256sum --check --strict/g) || []).length, 2);
  const publishes = workflow.split(/\r?\n/).filter((line) => /^\s+npm publish\b/.test(line));
  assert.equal(publishes.length, 4);
  for (const line of publishes) assert.match(line, /npm publish "\$CANDIDATE_TGZ" --provenance --access public/);
  const prepare = readFileSync(path.join(__dirname, 'prepare-release.js'), 'utf8');
  assert.match(prepare, /node\('check-packlist.js', \['--release', \.\.\.args\]\)/);
  assert.match(prepare, /node\('check-package-types.js', args\)/);
  assert.doesNotMatch(prepare, /['"]publish['"]/);
});
