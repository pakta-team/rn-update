/**
 * [INPUT]: 依赖 Hermes 验证/探测进程接口、共享超时解析器与隔离异步错误夹具
 * [OUTPUT]: 验证非法期限、挂起进程、外部取消和晚到错误都能有界收敛
 * [POS]: CLI Hermes 进程期限回归，覆盖验证器不会把 CI 或发布流程永久挂住
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import {
  compareHermesBytecode,
  probeHbcVersion,
} from '../src/utils/hermes-base';
import { hermesTimeout } from '../src/utils/hermes-timeout';

const keys = ['PAKTA_CACHE_DIR', 'PAKTA_HERMES_PROBE_TIMEOUT_MS'] as const;
describe('Hermes deadlines', () => {
  test('invalid or overflowing values cannot turn deadlines into a 1ms timer', () => {
    for (const value of [
      undefined,
      '',
      '0',
      '-1',
      'NaN',
      'Infinity',
      '1.5',
      '2147483648',
    ]) {
      expect(hermesTimeout(value, 2000)).toBe(2000);
    }
    expect(hermesTimeout('50', 2000)).toBe(50);
  });
});

describe.if(process.platform !== 'win32')('Hermes subprocess deadlines', () => {
  let dir: string;
  let hanging: string;
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rnu-hermes-timeout-'));
    process.env.PAKTA_CACHE_DIR = path.join(dir, 'cache');
    hanging = path.join(dir, 'hermesc');
    // exec, not a shell child: the killed process owns stdout and cannot leave
    // an inherited pipe open to prevent close/finish from settling.
    fs.writeFileSync(
      hanging,
      `#!/bin/sh\nexec "${process.execPath}" -e 'setInterval(() => {}, 1000)'\n`,
      { mode: 0o755 },
    );
  });
  afterEach(() => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    fs.removeSync(dir);
  });

  test('a hung synchronous version probe times out', () => {
    process.env.PAKTA_HERMES_PROBE_TIMEOUT_MS = '50';
    expect(probeHbcVersion(hanging)).toBeNull();
  }, 2000);

  test('hung pretty dumps time out and both children are reaped', async () => {
    const result = await compareHermesBytecode(
      hanging,
      'missing-a',
      'missing-b',
      { timeoutMs: 50 },
    );
    expect(result.status).toBe('dump-failed');
  }, 2000);

  test('external cancellation aborts active dump processes', async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 50);
    try {
      const result = await compareHermesBytecode(
        hanging,
        'missing-a',
        'missing-b',
        {
          signal: controller.signal,
          timeoutMs: 1000,
        },
      );
      expect(result.status).toBe('dump-failed');
    } finally {
      clearTimeout(timer);
    }
  }, 2000);

  test('an already-aborted request has no late unhandled errors in an isolated process', () => {
    const child = spawnSync(
      process.execPath,
      [
        path.join(__dirname, 'fixtures/hermes-async-check.cjs'),
        JSON.stringify({
          operation: 'abort',
          modulePath: require.resolve('../src/utils/hermes-base'),
          command: hanging,
        }),
      ],
      { encoding: 'utf8', timeout: 1500 },
    );
    expect(child.error).toBeUndefined();
    expect(child.signal).toBeNull();
    expect(child.status).toBe(0);
    expect(child.stderr).not.toContain('HERMES_ASYNC_ERROR');
    expect(child.stdout).toContain('"status":"dump-failed"');
  }, 2000);
});

describe('isolated async-error observer negative controls', () => {
  for (const [operation, event] of [
    ['control-rejection', 'unhandledRejection'],
    ['control-exception', 'uncaughtException'],
  ]) {
    test(`fails for a late ${event}`, () => {
      const child = spawnSync(
        process.execPath,
        [
          path.join(__dirname, 'fixtures/hermes-async-check.cjs'),
          JSON.stringify({ operation }),
        ],
        { encoding: 'utf8', timeout: 1500 },
      );
      expect(child.error).toBeUndefined();
      expect(child.signal).toBeNull();
      expect(child.status).toBe(1);
      expect(child.stderr).toContain(`HERMES_ASYNC_ERROR ${event}`);
    }, 2000);
  }
});
