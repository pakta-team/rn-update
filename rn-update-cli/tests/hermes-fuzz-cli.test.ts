/**
 * [INPUT]: 依赖 scripts/fuzz-hermes-base.ts 子进程、node:fs/os/path 与 bun:test
 * [OUTPUT]: 验证 ROUNDS 参数校验（非安全整数退出码 2）与 --help/--rounds 边界行为
 * [POS]: tests 的 fuzz CLI 契约测试，不依赖真实 hermesc
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const script = path.resolve(__dirname, '../scripts/fuzz-hermes-base.ts');

describe.skipIf(os.platform() === 'win32')(
  'Hermes fuzz CLI coverage gate',
  () => {
    test('all compiler failures return nonzero and preserve their inputs', () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'rnu-fuzz-failure-'));
      try {
        const compiler = path.join(dir, 'hermesc');
        const out = path.join(dir, 'cases');
        const calls = path.join(dir, 'compiler-called');
        writeFileSync(
          compiler,
          '#!/bin/sh\n: > "$HERMES_TEST_COMPILER_CALLS"\necho deliberate compiler failure >&2\nexit 1\n',
          { mode: 0o755 },
        );
        const result = spawnSync(
          process.execPath,
          [script, '--rounds', '2', '--seed', '7', '--out', out],
          {
            env: {
              ...process.env,
              HERMESC: compiler,
              HERMES_TEST_COMPILER_CALLS: calls,
            },
            encoding: 'utf8',
            timeout: 10_000,
          },
        );
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(1);
        expect(result.stdout).toContain('equivalent: 0');
        expect(result.stdout).toContain('compile errors (generator): 2');
        expect(existsSync(calls)).toBe(true);
        expect(
          existsSync(path.join(out, 'round-0000', 'compile-error.txt')),
        ).toBe(true);
        expect(
          existsSync(path.join(out, 'round-0001', 'compile-error.txt')),
        ).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }, 15_000);

    test.each([
      { args: ['--rounds'] },
      { args: ['--rounds', '--verbose'] },
      { args: ['--rounds', '--seed', '7'] },
      { args: ['--rounds', ''] },
    ])(
      'missing round values fail before starting any work: %j',
      ({ args }) => {
        const dir = mkdtempSync(path.join(os.tmpdir(), 'rnu-fuzz-args-'));
        try {
          const compiler = path.join(dir, 'hermesc');
          const out = path.join(dir, 'cases');
          const calls = path.join(dir, 'compiler-called');
          writeFileSync(
            compiler,
            '#!/bin/sh\n: > "$HERMES_TEST_COMPILER_CALLS"\nexit 1\n',
            { mode: 0o755 },
          );
          const result = spawnSync(
            process.execPath,
            [script, '--out', out, ...args],
            {
              env: {
                ...process.env,
                HERMESC: compiler,
                HERMES_TEST_COMPILER_CALLS: calls,
              },
              encoding: 'utf8',
              timeout: 10_000,
            },
          );
          expect(result.error).toBeUndefined();
          expect(result.status).toBe(2);
          expect(result.stderr).toContain(
            '--rounds must be a positive safe integer',
          );
          expect(result.stdout).not.toContain('fuzz-hermes-base:');
          expect(existsSync(calls)).toBe(false);
          expect(existsSync(out)).toBe(false);
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      },
      15_000,
    );

    test.each(['0', '-1', '0.5', 'NaN'])(
      'invalid round count %s cannot produce a green empty run',
      (rounds) => {
        const result = spawnSync(
          process.execPath,
          [script, '--rounds', rounds],
          {
            encoding: 'utf8',
            timeout: 10_000,
          },
        );
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(2);
        expect(result.stderr).toContain(
          '--rounds must be a positive safe integer',
        );
      },
      15_000,
    );
  },
);
