/**
 * [INPUT]: 依赖 hdc 传统/SDK26 完整安装回执及固定 Harmony 全套 Jest JSON 结果
 * [OUTPUT]: 提供拒绝伪成功安装、缺失/跳过业务用例及其它工程结果的验收门卫
 * [POS]: Harmony 编排与设备驱动共享的结果边界；命令退出零不能替代实际成功证明
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const fs = require('node:fs');
const path = require('node:path');
const { requireFile } = require('./harmony-e2e-sdk');

const REQUIRED_HARMONY_TESTS = {
  'local-update.test.ts': [
    'starts from the binary base bundle after a data reset',
    'applies the full package update (v1)',
    'applies the ppk diff update (v2)',
    'applies the v2-track diff update (v4)',
    'keeps the applied update across a relaunch',
    'reports up to date without switching bundles',
  ],
  'smoke.test.ts': [
    'launches the app and locates elements by testID',
    'locates elements by visible text',
    'survives a relaunch preserving install state',
  ],
};

function assertHdcInstallSuccess(output) {
  const confirmed =
    /\bApp installed successfully\b/i.test(output) ||
    /(?:^|\r?\n)\[Info\]App install path:[^\r\n]+ msg:install bundle successfully\.[ \t]*\r?\nAppMod finish[ \t]*(?:\r?\n|$)/i.test(
      output
    );
  if (
    /\b(?:fail(?:ed|ure)?|error|unsuccessfully)\b/i.test(output) ||
    !confirmed
  )
    throw new Error(
      'hdc did not confirm a successful HAP installation; inspect signing and target'
    );
}

function assertHarmonyTestResults(file, e2eRoot) {
  const report = JSON.parse(fs.readFileSync(requireFile(file), 'utf8'));
  if (
    report.success !== true ||
    report.wasInterrupted === true ||
    report.numFailedTests !== 0 ||
    report.numPendingTests !== 0 ||
    report.numTodoTests !== 0 ||
    report.numFailedTestSuites !== 0 ||
    report.numPendingTestSuites !== 0 ||
    report.numPassedTestSuites !== 2 ||
    report.numTotalTestSuites !== 2 ||
    !Number.isInteger(report.numPassedTests) ||
    report.numPassedTests < 9 ||
    report.numTotalTests !== report.numPassedTests ||
    report.testResults?.length !== 2
  )
    throw new Error(
      'Harmony full suite requires two passing suites and no skipped tests'
    );
  for (const [name, required] of Object.entries(REQUIRED_HARMONY_TESTS)) {
    const expectedPath = path.resolve(e2eRoot, 'e2e', 'harmony', name);
    const suites = report.testResults.filter(
      (suite) => path.resolve(suite.name) === expectedPath
    );
    if (suites.length !== 1 || suites[0].status !== 'passed')
      throw new Error(`Harmony required suite did not pass: ${name}`);
    const assertions = suites[0].assertionResults;
    if (
      !Array.isArray(assertions) ||
      assertions.some((item) => item.status !== 'passed')
    )
      throw new Error(`Harmony suite contains an unpassed test: ${name}`);
    for (const title of required)
      if (
        assertions.filter(
          (item) => item.title === title && item.status === 'passed'
        ).length !== 1
      )
        throw new Error(`Harmony required test did not pass: ${title}`);
  }
  return { suites: 2, passed: report.numPassedTests, skipped: 0 };
}

module.exports = {
  assertHdcInstallSuccess,
  assertHarmonyTestResults,
  REQUIRED_HARMONY_TESTS,
};
