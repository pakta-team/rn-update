/**
 * [INPUT]: 依赖 HarmonyDriver、真实本地服务、独立 healthy/crash HAP 与进程级 hilog
 * [OUTPUT]: 验证无 JS check 时 forceBoot 的否定/肯定路径；故障模式要求 JS fatal 先发生且 ArkTS 进程继续完成下载
 * [POS]: Harmony 独立原生设备套件，不注入 KV、不点击更新按钮、不修改生产轮次
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { HarmonyDriver } from '../harness/harmony-driver.ts';

const {
  TITLES,
  crashEvidence,
} = require('../../scripts/harmony-native-results');
const { hash } = require('../../scripts/harmony-e2e-sdk');
const variant = process.env.RNU_HARMONY_NATIVE_VARIANT;
assert.ok(variant === 'healthy' || variant === 'crash');
const runId = process.env.RNU_HARMONY_NATIVE_RUN_ID;
const evidenceDir = process.env.RNU_HARMONY_NATIVE_EVIDENCE_DIR || '';
assert.ok(runId && evidenceDir && process.env.HDC_TARGET);
const bundleName =
  process.env.RNU_HARMONY_BUNDLE_NAME || 'com.charmlot.testpakta';
const driver = new HarmonyDriver(bundleName);
const endpoint = 'http://127.0.0.1:31337';
const SETTLE_MS = 15000;

interface Observation {
  kind: string;
  at: number;
  platform?: string;
  hash?: string;
  responseHash?: string;
  forceBoot?: boolean;
  method?: string;
  path?: string;
}
interface Phase {
  name: 'negative' | 'forced';
  startedAt: number;
  observations: Observation[];
  finalState?: Record<string, string>;
  deviceStartEpoch?: number;
  failure?: { epoch: number; pid: string; line: string };
  failureObservedAt?: number;
  alivePid?: string;
  hilogSha256?: string;
}
const trace = {
  runId,
  variant,
  target: process.env.HDC_TARGET,
  manualJavaScriptChecks: 0,
  phases: [] as Phase[],
  persistedHash: '',
  nativeAcknowledgement: '',
};

async function serverState() {
  const response = await fetch(`${endpoint}/state`, {
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 200);
  return (await response.json()) as {
    forceBoot: boolean;
    observations: Observation[];
  };
}

async function setForceBoot(enabled: boolean) {
  const response = await fetch(`${endpoint}/control/force-boot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 200);
  assert.equal(
    ((await response.json()) as { forceBoot: boolean }).forceBoot,
    enabled
  );
}

async function appPid() {
  const pid = (await driver.shell(`pidof ${bundleName}`)).trim();
  assert.match(
    pid,
    /^\d+$/,
    'the test application must have exactly one live PID'
  );
  return pid;
}

async function observeFailure(phase: Phase) {
  const pid = await appPid();
  phase.failure = await driver.waitFor(
    async () => {
      const log = await driver.shell('hilog -x -v epoch -e HM_CRASH_PROBE');
      const failure = crashEvidence(log, pid, phase.deviceStartEpoch);
      const file = path.join(evidenceDir, `${phase.name}-hilog.log`);
      fs.writeFileSync(file, log);
      phase.hilogSha256 = hash(file);
      return failure;
    },
    {
      timeout: 8000,
      interval: 300,
      description: 'fresh early JS fatal from the live RNOH PID',
    }
  );
  phase.failureObservedAt = Date.now();
}

async function nativeDownload(phase: Phase) {
  await driver.waitFor(
    async () => {
      const state = await serverState();
      const observations = state.observations.filter(
        (item) => item.at >= phase.startedAt
      );
      const check = observations.find(
        (item) =>
          item.kind === 'check' &&
          item.platform === 'harmony' &&
          item.hash === '' &&
          item.responseHash === 'e2e-full-v1' &&
          item.forceBoot === (phase.name === 'forced')
      );
      return check &&
        observations.some(
          (item) =>
            item.kind === 'artifact' &&
            item.method === 'GET' &&
            item.path === '/artifacts/harmony/v1.ppk' &&
            item.at >= check.at
        )
        ? true
        : undefined;
    },
    {
      timeout: 45000,
      interval: 400,
      description:
        'native check and actual full-package request without a JS tap',
    }
  );
  // 请求出现并不等于安装提交；留出真实解压/封口时间后再观察下次冷启动。
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  if (variant === 'crash') phase.alivePid = await appPid();
}

async function snapshot(forced: boolean) {
  const expected = {
    'bundle-label': `bundleLabel: ${forced ? 'E2E_FULL_V1' : 'BINARY_BASE'}`,
    'current-hash': `currentHash: ${forced ? 'e2e-full-v1' : '(empty)'}`,
    'last-error': 'lastError: (none)',
    'rolled-back-version': 'rolledBackVersion: (none)',
  };
  return driver.waitFor(
    async () => {
      const nodes = await driver.dumpLayout();
      const state: Record<string, string> = {};
      for (const id of Object.keys(expected)) {
        const node = nodes.find((item) => item.id === id);
        if (node) state[id] = node.text;
      }
      return Object.entries(expected).every(([id, text]) => state[id] === text)
        ? state
        : undefined;
    },
    {
      timeout: 60000,
      description: `healthy ${forced ? 'full' : 'binary base'} state after native round`,
    }
  );
}

beforeAll(async () => {
  fs.mkdirSync(evidenceDir, { recursive: true });
  await driver.rport(31337, 31337);
  await setForceBoot(false);
});

afterAll(async () => {
  await setForceBoot(false);
});

it(TITLES[variant], async () => {
  try {
    for (const name of ['negative', 'forced'] as const) {
      await setForceBoot(name === 'forced');
      await driver.terminate();
      // 只重置显式测试应用，肯定路径也必须从无缓存 full 的状态真实下载。
      const cleaned = await driver.shell(`bm clean -n ${bundleName} -d`);
      assert.match(cleaned, /success/i);
      const phase: Phase = { name, startedAt: Date.now(), observations: [] };
      trace.phases.push(phase);
      phase.deviceStartEpoch = Number((await driver.shell('date +%s')).trim());
      assert.ok(
        Number.isFinite(phase.deviceStartEpoch) && phase.deviceStartEpoch > 0
      );
      await driver.launch();
      if (variant === 'crash') await observeFailure(phase);
      await nativeDownload(phase);
      await setForceBoot(false);
      await driver.relaunch();
      phase.finalState = await snapshot(name === 'forced');
      phase.observations = (await serverState()).observations.filter(
        (item) => item.at >= phase.startedAt
      );
    }
    await driver.waitFor(
      async () =>
        (await driver.findById('last-event'))?.text ===
        'lastEvent: forceBootRescue'
          ? true
          : undefined,
      {
        timeout: 30000,
        description:
          'forceBootRescue emitted only after native markSuccess accepted',
      }
    );
    trace.nativeAcknowledgement = 'forceBootRescue';
    await driver.relaunch();
    await snapshot(true);
    trace.persistedHash = 'e2e-full-v1';
  } finally {
    fs.writeFileSync(
      path.join(evidenceDir, 'harmony-native-observations.json'),
      `${JSON.stringify(trace, null, 2)}\n`
    );
  }
});
