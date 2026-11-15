/**
 * [INPUT]: 依赖 Node test、真实版本脚本与隔离 SDK/Harmony 元数据夹具
 * [OUTPUT]: 验证独立检出同步、版本漂移/错误 tag 拒绝，保护父目录与兄弟 CLI 元数据
 * [POS]: scripts 的发布边界回归，不构建或发布包，不改真实版本
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

test('standalone version sync owns only this SDK and Harmony metadata', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'pakta-standalone-version-'));
  const root = path.join(parent, 'sdk');
  for (const dir of ['scripts', 'harmony/pakta']) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  fs.mkdirSync(path.join(parent, 'rn-update-cli'));
  for (const file of ['package.json', 'rn-update-cli/package.json']) {
    fs.writeFileSync(path.join(parent, file), '{"version":"9.9.9"}\n');
  }
  fs.writeFileSync(path.join(root, 'package.json'), '{"version":"1.1.0"}\n');
  fs.writeFileSync(path.join(root, 'harmony/pakta/oh-package.json5'), "{\n version: '1.1.0',\n}\n");
  fs.writeFileSync(path.join(root, 'harmony/pakta/BuildProfile.ets'), "export const HAR_VERSION = '1.1.0';\n");
  for (const file of ['release-version.js', 'check-release-version.js']) {
    fs.copyFileSync(path.join(__dirname, file), path.join(root, 'scripts', file));
  }
  function run(script, args = [], tag = 'v1.1.0') {
    return spawnSync(process.execPath, [path.join(root, 'scripts', script), ...args], {
      cwd: root, encoding: 'utf8', env: { ...process.env, RELEASE_VERSION: tag },
    });
  }
  assert.equal(run('release-version.js', ['--check']).status, 0);
  assert.equal(run('check-release-version.js').status, 0);
  fs.writeFileSync(path.join(root, 'harmony/pakta/BuildProfile.ets'), "export const HAR_VERSION = '0.0.0';\n");
  assert.notEqual(run('release-version.js', ['--check']).status, 0);
  assert.notEqual(run('check-release-version.js').status, 0);
  const synced = run('release-version.js', ['1.2.0-beta.1']);
  assert.equal(synced.status, 0, synced.stderr);
  assert.equal(run('release-version.js', ['--check']).status, 0);
  assert.equal(run('check-release-version.js', [], 'v1.2.0-beta.1').status, 0);
  assert.notEqual(run('check-release-version.js', [], 'v1.1.0').status, 0);
  assert.notEqual(run('release-version.js', ['invalid-version']).status, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version, '1.2.0-beta.1');
  for (const file of ['package.json', 'rn-update-cli/package.json']) {
    assert.equal(fs.readFileSync(path.join(parent, file), 'utf8'), '{"version":"9.9.9"}\n');
  }
});
