/**
 * [INPUT]: 依赖 Node 测试器、传统/SDK26 真实 HDC 回执与 Jest JSON 夹具
 * [OUTPUT]: 验证失败文本混入、缺失/跳过用例、错工程和空套件不能生成全套通过证明
 * [POS]: Harmony 结果门卫的持久回归；只验证结果契约，不冒充设备执行
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  assertHdcInstallSuccess,
  assertHarmonyTestResults,
  REQUIRED_HARMONY_TESTS,
} = require('./harmony-e2e-results');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harmony results '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'results.json');
  const report = {
    success: true,
    wasInterrupted: false,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    numFailedTestSuites: 0,
    numPendingTestSuites: 0,
    numPassedTestSuites: 2,
    numTotalTestSuites: 2,
    numPassedTests: 9,
    numTotalTests: 9,
    testResults: Object.entries(REQUIRED_HARMONY_TESTS).map(
      ([name, titles]) => ({
        name: path.join(root, 'e2e', 'harmony', name),
        status: 'passed',
        assertionResults: titles.map((title) => ({ title, status: 'passed' })),
      })
    ),
  };
  return {
    root,
    report,
    check() {
      fs.writeFileSync(file, JSON.stringify(report));
      return assertHarmonyTestResults(file, root);
    },
  };
}

test('HDC requires a complete known installation success receipt without failure output', () => {
  const sdk26 = Buffer.from(
    require('./hdc-sdk26-install-output.json').stdoutBase64,
    'base64'
  ).toString('utf8');
  for (const output of [
    '[Info]App installed successfully.',
    sdk26,
    sdk26.replaceAll('\r\n', '\n'),
  ])
    assert.doesNotThrow(() => assertHdcInstallSuccess(output));
  for (const output of [
    '',
    'App installed unsuccessfully.',
    '[Fail]App installed successfully.',
    '[Error] App installed successfully.',
    'Not match target',
    sdk26.replace('successfully', 'unsuccessfully'),
    sdk26.replace(/AppMod finish[\r\n]*/, ''),
    sdk26.replace(
      'msg:install bundle successfully.',
      'msg:install bundle failed.'
    ),
    `[Fail] install failed\n${sdk26}`,
    `${sdk26}[Error] installation failed`,
    'install bundle successfully.\nAppMod finish',
  ])
    assert.throws(() => assertHdcInstallSuccess(output), /did not confirm/);
});

test('all required tests from both actual Harmony suite paths pass', (t) => {
  assert.deepEqual(fixture(t).check(), { suites: 2, passed: 9, skipped: 0 });
});

test('green summary cannot hide a missing business assertion', (t) => {
  const { report, check } = fixture(t);
  report.testResults[0].assertionResults.pop();
  assert.throws(check, /required test did not pass/);
});

test('skipped and failed assertions are refused despite green aggregate fields', (t) => {
  for (const status of ['pending', 'todo', 'failed', 'skipped']) {
    const { report, check } = fixture(t);
    report.testResults[0].assertionResults[0].status = status;
    assert.throws(check, /unpassed test/);
  }
});

test('no-tests, smoke-only, interrupted and skipped suite summaries are refused', (t) => {
  for (const change of [
    (report) => {
      report.numPassedTests = 0;
      report.numTotalTests = 0;
    },
    (report) => {
      report.numPassedTestSuites = 1;
      report.numTotalTestSuites = 1;
    },
    (report) => {
      report.wasInterrupted = true;
    },
    (report) => {
      report.numPendingTests = 1;
    },
    (report) => {
      report.numPassedTests = undefined;
      report.numTotalTests = undefined;
    },
  ]) {
    const { report, check } = fixture(t);
    change(report);
    assert.throws(check, /full suite requires/);
  }
});

test('results from another project and duplicate required titles are refused', (t) => {
  const foreign = fixture(t);
  foreign.report.testResults[0].name = path.join(
    foreign.root,
    'other',
    'local-update.test.ts'
  );
  assert.throws(foreign.check, /required suite did not pass/);
  const duplicate = fixture(t);
  duplicate.report.testResults[0].assertionResults.push(
    duplicate.report.testResults[0].assertionResults[0]
  );
  assert.throws(duplicate.check, /required test did not pass/);
});
