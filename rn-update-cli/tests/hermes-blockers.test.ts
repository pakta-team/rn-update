/**
 * [INPUT]: 依赖 Hermes raw 函数完整性校验、反汇编归一化与 Node 子进程
 * [OUTPUT]: 验证零长度函数、截断 dump、取消、超时和 debug 输出失败的收敛行为
 * [POS]: CLI Hermes 验证器的进程清理回归，确保失败不会泄漏异步错误或文件句柄
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { removeSync } from '../src/utils/fs-helpers';
import { normalizeDisassemblyLine } from '../src/utils/hermes-base';
import type { LiteralBuffers } from '../src/utils/hermes-literals';
import {
  type HermesSemanticData,
  normalizeRawHermesFunction,
} from '../src/utils/hermes-raw';

const buffers: LiteralBuffers = {
  layout: 'shaped',
  version: 98,
  values: Buffer.alloc(0),
  objectKeys: Buffer.alloc(0),
  shapes: Buffer.alloc(0),
};

/** Minimal HBC data isolates completeness checks from compiler optimization. */
function functionData(size: number): HermesSemanticData {
  return {
    bytes: Buffer.alloc(size),
    version: 98,
    strings: new Map(),
    functions: [{ offset: 0, size, metadata: '["dead",2,[]]' }],
    bigints: [],
    regexps: [],
    metadata: '[]',
  };
}

test('classic switch offsets fold but default destinations remain significant', () => {
  const normalize = (line: string) => normalizeDisassemblyLine(line, new Map());
  expect(normalize('    SwitchImm r2, 2339, L7, 0, 31')).toBe(
    normalize('    SwitchImm r2, 2340, L7, 0, 31'),
  );
  expect(normalize('    SwitchImm r2, 2339, L7, 0, 31')).not.toBe(
    normalize('    SwitchImm r2, 2340, L8, 0, 31'),
  );
});

describe('raw function completeness', () => {
  test('a declared zero-length function retains metadata without instructions', () => {
    const data = functionData(0);
    expect(normalizeRawHermesFunction([], data, 0, buffers)).toEqual([
      data.functions[0].metadata,
    ]);
  });

  test('missing instructions in a non-empty function still fail closed', () => {
    expect(() =>
      normalizeRawHermesFunction([], functionData(1), 0, buffers),
    ).toThrow('raw dump ended before the function body');
  });

  test('instructions cannot be injected into a declared empty function', () => {
    expect(() =>
      normalizeRawHermesFunction(
        ['[@ 0] Unreachable'],
        functionData(0),
        0,
        buffers,
      ),
    ).toThrow('raw dump ended before the function body');
  });

  test('restricted global properties compare by string value, not string ID', () => {
    const normalize = (id: number, value: string) => {
      const data = functionData(5);
      data.version = 96;
      data.bytes.writeUInt32LE(id, 1);
      data.strings.set(id, value);
      return normalizeRawHermesFunction(
        [`[@ 0] ThrowIfHasRestrictedGlobalProperty ${id}<UInt32>`],
        data,
        0,
        {
          layout: 'split',
          version: 96,
          array: Buffer.alloc(0),
          objectKeys: Buffer.alloc(0),
          objectValues: Buffer.alloc(0),
        },
      );
    };
    expect(normalize(1, 'shared-prefix-global-A')).toEqual(
      normalize(4096, 'shared-prefix-global-A'),
    );
    expect(normalize(1, 'shared-prefix-global-A')).not.toEqual(
      normalize(4096, 'shared-prefix-global-B'),
    );
  });
});

// Isolate the API call: a pending Promise can let Node/Bun exit without a
// result, and a leaked child can instead keep it alive. Check marker AND exit.
describe.if(process.platform !== 'win32')('debug dump failure cleanup', () => {
  let dir: string;
  let command: string;
  // CI also exercises these child-process paths against the built Node 18 API.
  const runtime = process.env.HERMES_TEST_NODE || process.execPath;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-debug-exit-'));
    command = path.join(dir, 'hermesc');
    fs.writeFileSync(
      command,
      `#!/bin/sh\nexec "${runtime}" -e 'setInterval(() => {}, 1000)'\n`,
      { mode: 0o755 },
    );
  });
  afterEach(() => removeSync(dir));

  for (const scenario of ['timeout', 'abort', 'pre-abort', 'ENOENT'] as const) {
    test(`${scenario} with dumpTo returns and closes debug streams`, () => {
      const dumpTo = {
        withBase: path.join(dir, 'base.txt'),
        plain: path.join(dir, 'plain.txt'),
      };
      const child = spawnSync(
        runtime,
        [
          path.join(__dirname, 'fixtures/hermes-async-check.cjs'),
          JSON.stringify({
            operation: 'verify',
            modulePath: process.env.HERMES_TEST_NODE
              ? path.resolve(__dirname, '../lib/utils/hermes-base.js')
              : require.resolve('../src/utils/hermes-base'),
            command: scenario === 'ENOENT' ? `${command}-missing` : command,
            abortAfterMs:
              scenario === 'pre-abort'
                ? 0
                : scenario === 'abort'
                  ? 100
                  : undefined,
            options: { dumpTo, timeoutMs: scenario === 'timeout' ? 100 : 1000 },
          }),
        ],
        { encoding: 'utf8', timeout: 2500 },
      );
      expect(child.error, child.stderr).toBeUndefined();
      expect(child.signal).toBeNull();
      expect(child.status, child.stderr).toBe(0);
      expect(child.stderr).not.toContain('HERMES_ASYNC_ERROR');
      expect(child.stdout).toContain('HERMES_ASYNC_RESULT');
      expect(child.stdout).toContain('"status":"dump-failed"');
      for (const file of Object.values(dumpTo)) {
        expect(fs.readFileSync(file, 'utf8')).toBe('');
      }
    }, 4000);
  }
});
