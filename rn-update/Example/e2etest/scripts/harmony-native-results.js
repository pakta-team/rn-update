/**
 * [INPUT]: 依赖完整单套 Jest JSON、带 runId 的设备轨迹、服务器请求时间与原始 hilog
 * [OUTPUT]: 提供 native/JS 故障验收的证据门卫与进程级崩溃日志解析
 * [POS]: Harmony 独立原生套件的结果边界；缺少实际请求、故障或健康终态均不能生成通过证明
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { hash, requireFile } = require('./harmony-e2e-sdk');

const TITLES = {
  healthy: 'activates only forceBoot with no JavaScript check',
  crash:
    'continues native forceBoot after an observed early JavaScript failure',
};
const CRASH_MARKER = 'HM_CRASH_PROBE: uncaught JS error at +1s';

function crashEvidence(log, pid, earliestEpoch) {
  assert.match(String(pid), /^\d+$/, 'one live application PID is required');
  const matches = log.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^(\d+\.\d+)\s+(\d+)\s+\d+\s+[DIWEF]\s/);
    return match &&
      match[2] === String(pid) &&
      Number(match[1]) >= earliestEpoch &&
      line.includes(CRASH_MARKER)
      ? [{ epoch: Number(match[1]), pid: String(pid), line }]
      : [];
  });
  assert.ok(
    matches.length,
    'fresh JS failure from the live application PID was not observed'
  );
  return matches[0];
}

function assertNativeTrace(file, { runId, variant, target }) {
  const trace = JSON.parse(fs.readFileSync(requireFile(file), 'utf8'));
  assert.equal(trace.runId, runId, 'native trace belongs to another run');
  assert.equal(trace.variant, variant);
  assert.equal(trace.target, target);
  assert.equal(trace.manualJavaScriptChecks, 0);
  assert.equal(
    trace.nativeAcknowledgement,
    'forceBootRescue',
    'native markSuccess acknowledgement is missing'
  );
  assert.deepEqual(
    trace.phases.map((phase) => phase.name),
    ['negative', 'forced']
  );
  for (const phase of trace.phases) {
    const forced = phase.name === 'forced';
    assert.ok(phase.startedAt > 0);
    const checks = phase.observations.filter(
      (item) =>
        item.kind === 'check' &&
        item.platform === 'harmony' &&
        item.hash === '' &&
        item.responseHash === 'e2e-full-v1' &&
        item.forceBoot === forced &&
        item.at >= phase.startedAt
    );
    assert.ok(
      checks.length,
      'native check with the expected forceBoot directive is missing'
    );
    assert.ok(
      phase.observations.some(
        (item) =>
          item.kind === 'artifact' &&
          item.method === 'GET' &&
          item.path === '/artifacts/harmony/v1.ppk' &&
          item.at >= checks[0].at
      ),
      'fresh full download was not observed'
    );
    assert.deepEqual(phase.finalState, {
      'bundle-label': `bundleLabel: ${forced ? 'E2E_FULL_V1' : 'BINARY_BASE'}`,
      'current-hash': `currentHash: ${forced ? 'e2e-full-v1' : '(empty)'}`,
      'last-error': 'lastError: (none)',
      'rolled-back-version': 'rolledBackVersion: (none)',
    });
    if (variant === 'crash') {
      assert.equal(
        phase.alivePid,
        phase.failure.pid,
        'RNOH process died before native rescue'
      );
      const logFile = path.join(path.dirname(file), `${phase.name}-hilog.log`);
      assert.equal(hash(requireFile(logFile)), phase.hilogSha256);
      assert.deepEqual(
        crashEvidence(
          fs.readFileSync(logFile, 'utf8'),
          phase.alivePid,
          phase.deviceStartEpoch
        ),
        phase.failure
      );
      assert.ok(
        phase.failureObservedAt < checks[0].at,
        'native request was not observed after the JS failure'
      );
    }
  }
  assert.equal(trace.persistedHash, 'e2e-full-v1');
  return trace;
}

function assertNativeResults(file, e2eRoot, expected) {
  const result = JSON.parse(fs.readFileSync(requireFile(file), 'utf8'));
  for (const key of [
    'numFailedTests',
    'numPendingTests',
    'numTodoTests',
    'numFailedTestSuites',
    'numPendingTestSuites',
  ])
    assert.equal(result[key], 0, `native result contains ${key}`);
  assert.equal(result.success, true);
  assert.notEqual(result.wasInterrupted, true);
  for (const key of [
    'numPassedTests',
    'numTotalTests',
    'numPassedTestSuites',
    'numTotalTestSuites',
  ])
    assert.equal(
      result[key],
      1,
      'the complete independent native suite must pass'
    );
  assert.equal(result.testResults.length, 1);
  const suite = result.testResults[0];
  assert.equal(
    path.resolve(suite.name),
    path.resolve(e2eRoot, 'e2e/harmony-native/native-check.test.ts')
  );
  assert.equal(suite.status, 'passed');
  assert.equal(suite.assertionResults.length, 1);
  assert.equal(suite.assertionResults[0].title, TITLES[expected.variant]);
  assert.equal(suite.assertionResults[0].status, 'passed');
  const traceFile = path.join(
    expected.artifacts,
    'harmony-native-observations.json'
  );
  assertNativeTrace(traceFile, expected);
  return {
    suites: 1,
    passed: 1,
    skipped: 0,
    nativeCase: expected.variant,
    observationsSha256: hash(traceFile),
  };
}

module.exports = {
  TITLES,
  CRASH_MARKER,
  crashEvidence,
  assertNativeTrace,
  assertNativeResults,
};
