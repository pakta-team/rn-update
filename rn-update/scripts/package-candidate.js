/**
 * [INPUT]: 依赖 tar、候选 tgz、可选 SHA-256 与当前 package.json 身份
 * [OUTPUT]: 提供 readCandidate、candidateHash，拒绝身份、摘要及归档路径不匹配
 * [POS]: scripts 的候选读取边界，供清单、消费与发布准备共享，不执行发布
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');

function candidateHash(tarball) {
  return createHash('sha256').update(readFileSync(tarball)).digest('hex');
}

function readCandidate(tarball, expectedSha256) {
  tarball = path.resolve(tarball);
  assert(tarball.endsWith('.tgz'), 'candidate must be a .tgz');
  const sha256 = candidateHash(tarball);
  if (expectedSha256 !== undefined) {
    assert.match(expectedSha256, /^[a-f0-9]{64}$/, 'invalid candidate SHA-256');
    assert.equal(sha256, expectedSha256, 'candidate SHA-256 mismatch');
  }
  const entries = execFileSync('tar', ['-tzf', tarball], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  }).trim().split(/\r?\n/);
  for (const entry of entries) {
    assert(entry.startsWith('package/'), `invalid candidate entry: ${entry}`);
    assert(!entry.includes('\\') && !/[\x00-\x1f\x7f]/.test(entry) &&
      !entry.split('/').includes('..') && path.posix.normalize(entry) === entry,
      `unsafe candidate entry: ${entry}`);
  }
  const listing = execFileSync('tar', ['-tvzf', tarball], {
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  }).trim().split(/\r?\n/);
  assert.equal(listing.length, entries.length, 'candidate entry listing mismatch');
  for (const entry of listing) {
    assert(/^[-d]/.test(entry), `non-regular candidate entry: ${entry}`);
  }
  const files = entries.filter((entry) => !entry.endsWith('/'))
    .map((entry) => entry.slice('package/'.length));
  assert.equal(new Set(files).size, files.length, 'duplicate candidate entries');
  const metadata = JSON.parse(execFileSync('tar', [
    '-xOf', tarball, 'package/package.json',
  ], { encoding: 'utf8' }));
  const expected = require('../package.json');
  assert.equal(metadata.name, expected.name, 'candidate name mismatch');
  assert.equal(metadata.version, expected.version, 'candidate version mismatch');
  const readFile = (file) => {
    assert(files.includes(file), `missing candidate file: ${file}`);
    return execFileSync('tar', ['-xOf', tarball, `package/${file}`], {
      maxBuffer: 128 * 1024 * 1024,
    });
  };
  return { tarball, sha256, files, metadata, readFile };
}

module.exports = { readCandidate, candidateHash };
