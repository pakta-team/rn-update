/**
 * [INPUT]: 依赖 Node 测试器、独立运行轨迹与真实 hilog 文本形状
 * [OUTPUT]: 锁定旧日志、错 PID、缺少下载、错误激活与陈旧运行不能伪造 native 通过
 * [POS]: Harmony native 证据门卫的确定性负控，不计为设备执行
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { hash } = require('./harmony-e2e-sdk');
const {
  TITLES,
  CRASH_MARKER,
  crashEvidence,
  assertNativeTrace,
  assertNativeResults,
} = require('./harmony-native-results');
const { nativeContext } = require('./run-harmony-native-e2e');

function fixture(t, variant = 'crash') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harmony-native-guards-'));
  t.after(() => {
    assert.ok(
      path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)
    );
    fs.rmSync(root, { recursive: true, force: true });
  });
  const expected = {
    runId: 'current-run',
    variant,
    target: 'explicit-device',
    artifacts: root,
  };
  const trace = {
    ...expected,
    manualJavaScriptChecks: 0,
    nativeAcknowledgement: 'forceBootRescue',
    persistedHash: 'e2e-full-v1',
    phases: ['negative', 'forced'].map((name, index) => {
      const forced = name === 'forced';
      const pid = String(42 + index);
      const log = `1000.100 ${pid} 7 E A0ff00/#RNOH_JS: ${CRASH_MARKER}\n`;
      const file = path.join(root, `${name}-hilog.log`);
      fs.writeFileSync(file, log);
      return {
        name,
        startedAt: 1000000,
        deviceStartEpoch: 1000,
        failure: crashEvidence(log, pid, 1000),
        failureObservedAt: 1000001,
        alivePid: pid,
        hilogSha256: hash(file),
        observations: [
          {
            kind: 'check',
            at: 1000002,
            platform: 'harmony',
            hash: '',
            responseHash: 'e2e-full-v1',
            forceBoot: forced,
          },
          {
            kind: 'artifact',
            at: 1000003,
            method: 'GET',
            path: '/artifacts/harmony/v1.ppk',
          },
        ],
        finalState: {
          'bundle-label': `bundleLabel: ${forced ? 'E2E_FULL_V1' : 'BINARY_BASE'}`,
          'current-hash': `currentHash: ${forced ? 'e2e-full-v1' : '(empty)'}`,
          'last-error': 'lastError: (none)',
          'rolled-back-version': 'rolledBackVersion: (none)',
        },
      };
    }),
  };
  const file = path.join(root, 'harmony-native-observations.json');
  const write = () => fs.writeFileSync(file, JSON.stringify(trace));
  write();
  return {
    root,
    file,
    trace,
    expected,
    write,
    check() {
      write();
      return assertNativeTrace(file, expected);
    },
  };
}

test('fresh same-PID fault, real requests, negative base and forced persistent full pass', (t) => {
  assert.equal(fixture(t).check().persistedHash, 'e2e-full-v1');
  assert.equal(fixture(t, 'healthy').check().variant, 'healthy');
});

test('failure evidence rejects missing marker, wrong PID, stale epoch and dead process', (t) => {
  for (const [log, pid, earliest] of [
    ['', '42', 1000],
    [`1000.100 42 7 E log: ${CRASH_MARKER}`, '43', 1000],
    [`1000.100 42 7 E log: ${CRASH_MARKER}`, '42', 1001],
  ])
    assert.throws(
      () => crashEvidence(log, pid, earliest),
      /failure.*not observed/
    );
  const f = fixture(t);
  f.trace.phases[1].alivePid = '99';
  assert.throws(() => f.check(), /process died/);
});

test('native trace rejects stale run, missing download and requests before the observed fatal', (t) => {
  for (const mutate of [
    (f) => {
      f.trace.nativeAcknowledgement = '';
    },
    (f) => {
      f.trace.runId = 'old';
    },
    (f) => {
      f.trace.phases[1].observations.pop();
    },
    (f) => {
      f.trace.phases[1].failureObservedAt = 1000004;
    },
  ]) {
    const f = fixture(t);
    mutate(f);
    assert.throws(() => f.check());
  }
});

test('native trace rejects auto-activation without forceBoot and false forced state', (t) => {
  for (const mutate of [
    (f) => {
      f.trace.phases[0].finalState['current-hash'] = 'currentHash: e2e-full-v1';
    },
    (f) => {
      f.trace.phases[1].observations[0].forceBoot = false;
    },
    (f) => {
      f.trace.phases[1].finalState['rolled-back-version'] =
        'rolledBackVersion: broken';
    },
  ]) {
    const f = fixture(t);
    mutate(f);
    assert.throws(() => f.check());
  }
});

test('native trace binds original fatal log bytes', (t) => {
  const f = fixture(t);
  fs.appendFileSync(path.join(f.root, 'forced-hilog.log'), 'changed');
  assert.throws(() => f.check());
});

test('independent full native result rejects wrong suite, skip and old trace', (t) => {
  const f = fixture(t);
  const result = {
    success: true,
    wasInterrupted: false,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    numFailedTestSuites: 0,
    numPendingTestSuites: 0,
    numPassedTests: 1,
    numTotalTests: 1,
    numPassedTestSuites: 1,
    numTotalTestSuites: 1,
    testResults: [
      {
        name: path.join(f.root, 'e2e/harmony-native/native-check.test.ts'),
        status: 'passed',
        assertionResults: [{ title: TITLES.crash, status: 'passed' }],
      },
    ],
  };
  const file = path.join(f.root, 'results.json');
  const check = () => {
    fs.writeFileSync(file, JSON.stringify(result));
    return assertNativeResults(file, f.root, f.expected);
  };
  assert.equal(check().nativeCase, 'crash');
  result.numPendingTests = 1;
  assert.throws(check);
  result.numPendingTests = 0;
  result.testResults[0].name = path.join(f.root, 'foreign.test.ts');
  assert.throws(check);
});

test('native context requires separate explicit project and preserves the original artifacts', () => {
  const env = {
    RNU_HARMONY_PROJECT: path.resolve('original'),
    RNU_HARMONY_NATIVE_PROJECT: path.resolve('native'),
  };
  const { ctx, original } = nativeContext('crash', env);
  assert.notEqual(ctx.artifacts, original.artifacts);
  assert.equal(ctx.bundleEntry, 'e2e/entry.crashprobe.ts');
  assert.equal(original.bundleEntry, 'e2e/entry.base.ts');
  assert.throws(
    () =>
      nativeContext('crash', {
        ...env,
        RNU_HARMONY_NATIVE_PROJECT: env.RNU_HARMONY_PROJECT,
      }),
    /must differ/
  );
  assert.throws(() => nativeContext('unknown', env));
  assert.throws(() =>
    nativeContext('healthy', { RNU_HARMONY_PROJECT: env.RNU_HARMONY_PROJECT })
  );
});
