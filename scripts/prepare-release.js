#!/usr/bin/env node
/**
 * [INPUT]: 依赖已同步版本、原生发布产物、npm pack 生命周期与候选清单/消费闸门
 * [OUTPUT]: 仅生成一次 tgz，校验后输出绝对路径及 SHA-256 到 GITHUB_OUTPUT 或终端
 * [POS]: scripts 的发布候选准备器，不调用 npm publish、不改变发布权限
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { appendFileSync, mkdtempSync, readdirSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readCandidate, candidateHash } = require('./package-candidate');

const root = path.resolve(__dirname, '..');
function node(script, args = []) {
  execFileSync(process.execPath, [path.join(__dirname, script), ...args], {
    cwd: root, stdio: 'inherit',
  });
}
node('release-version.js', ['--check']);
node('check-release-version.js');
node('verify-android-so.js');
const directory = mkdtempSync(path.join(os.tmpdir(), 'pakta-release-'));
execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', [
  'pack', '--pack-destination', directory,
], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
const archives = readdirSync(directory).filter((file) => file.endsWith('.tgz'));
assert.equal(archives.length, 1, 'expected exactly one release candidate');
const candidate = readCandidate(path.join(directory, archives[0]));
const args = [candidate.tarball, '--sha256', candidate.sha256];
node('check-packlist.js', ['--release', ...args]);
node('check-package-types.js', args);
assert.equal(candidateHash(candidate.tarball), candidate.sha256, 'candidate changed during checks');
const outputs = `tarball=${candidate.tarball}\nsha256=${candidate.sha256}\n`;
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, outputs);
process.stdout.write(outputs);
