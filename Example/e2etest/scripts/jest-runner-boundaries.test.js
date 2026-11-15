/**
 * [INPUT]: 依赖真实 Jest --listTests、主 Detox 配置与独立 Harmony native 配置
 * [OUTPUT]: 持久验证普通三套与独立原生一套的发现边界，不执行测试或访问设备
 * [POS]: 防止新增平台目录被通用通配符误收集；RN077生成器复制同一主配置，保持相同隔离
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');

const project = path.resolve(__dirname, '..');
function list(config) {
  const output = execFileSync(
    process.execPath,
    [
      require.resolve('jest/bin/jest'),
      '--config',
      path.join(project, config),
      '--listTests',
      '--runInBand',
      '--json',
    ],
    { cwd: project, encoding: 'utf8', timeout: 60000 }
  );
  return JSON.parse(output)
    .map((file) => path.relative(project, file).split(path.sep).join('/'))
    .sort();
}

test('normal Detox runner discovers only its three core suites', () => {
  assert.deepEqual(list('e2e/jest.config.js'), [
    'e2e/android-boundaries.test.ts',
    'e2e/bundle-hash.test.ts',
    'e2e/local-merge.test.ts',
  ]);
});

test('Harmony native runner retains its exclusive suite without Detox core suites', () => {
  assert.deepEqual(list('e2e/harmony-native.jest.config.js'), [
    'e2e/harmony-native/native-check.test.ts',
  ]);
});
