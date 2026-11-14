/**
 * [INPUT]: 依赖 scripts/hermes-fuzz-result 的 HermesFuzzSummary/hermesFuzzSucceeded 与 node:fs/os/path
 * [OUTPUT]: 验证 PR #85 复审回归：空轮次、planted 漏检、compileErrors 比例的终局裁决
 * [POS]: tests 的模糊测试裁决回归，锁死 hermesFuzzSucceeded 的真值表
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  type HermesFuzzSummary,
  hermesFuzzSucceeded,
} from '../scripts/hermes-fuzz-result';
import {
  compareHermesBytecode,
  normalizeDisassemblyLine,
} from '../src/utils/hermes-base';
import {
  type LiteralBuffers,
  LiteralResolver,
} from '../src/utils/hermes-literals';
import {
  type HermesSemanticData,
  normalizeRawHermesFunction,
} from '../src/utils/hermes-raw';

// Synthetic binary sections, not an HBC file emitted by a compiler. The opcode
// name comes from the raw dump; operand bytes are checked by the production audit.
function cachedObject(shapeIndex: number, names = ['field']) {
  const strings = new Map(names.map((name, i) => [i + 1, name]));
  const objectKeys = Buffer.alloc(1 + names.length * 2);
  objectKeys[0] = 0x50 | names.length;
  names.forEach((_name, i) => {
    objectKeys.writeUInt16LE(i + 1, 1 + i * 2);
  });
  const shapes = Buffer.alloc((shapeIndex + 1) * 8);
  shapes.writeUInt32LE(names.length, shapeIndex * 8 + 4);
  const buffers: LiteralBuffers = {
    layout: 'shaped',
    version: 98,
    values: Buffer.alloc(0),
    objectKeys,
    shapes,
  };
  const bytes = Buffer.alloc(8);
  bytes[2] = 1;
  bytes.writeUInt32LE(shapeIndex, 3);
  const data: HermesSemanticData = {
    bytes,
    version: 98,
    strings,
    functions: [{ offset: 0, size: bytes.length, metadata: '[]' }],
    bigints: [],
    regexps: [],
    metadata: '[]',
  };
  const resolver = new LiteralResolver(buffers, strings);
  const line = `    CacheNewObject r0, r1, ${shapeIndex}, 0`;
  const raw = () =>
    normalizeRawHermesFunction(
      [
        `[@ 0] CacheNewObject 0<Reg8>, 1<Reg8>, ${shapeIndex}<UInt32>, 0<UInt8>`,
      ],
      data,
      0,
      buffers,
    );
  const pretty = (text = line) =>
    normalizeDisassemblyLine(text, strings, resolver);
  return { data, buffers, strings, resolver, line, raw, pretty };
}

describe('CacheNewObject shape references', () => {
  test('relocated shapes agree in both pretty and raw comparisons', () => {
    const plain = cachedObject(0);
    const delta = cachedObject(7);
    expect(plain.raw()).toEqual(delta.raw());
    expect(plain.pretty()).toBe(delta.pretty());
    expect(plain.pretty()).toContain('field');
  });

  test.each([
    [['field'], ['differentField']],
    [
      ['first', 'second'],
      ['second', 'first'],
    ],
    [['a  b'], ['a b']],
    [['sharedLongPropertyPrefix甲'], ['sharedLongPropertyPrefix乙']],
  ])('changed keys remain different: %j versus %j', (left, right) => {
    const a = cachedObject(0, left);
    const b = cachedObject(7, right);
    expect(a.pretty()).not.toBe(b.pretty());
    expect(a.raw()).not.toEqual(b.raw());
  });

  test.each([
    '    CacheNewObject r2, r1, 0, 0',
    '    CacheNewObject r0, r2, 0, 0',
    '    CacheNewObject r0, r1, 0, 1',
  ])('retains registers and the cache operand: %s', (line) => {
    const fixture = cachedObject(0);
    expect(fixture.pretty(line)).not.toBe(fixture.pretty());
  });

  test('accepts column padding and tabs without changing key whitespace', () => {
    const fixture = cachedObject(0, ['a  b']);
    expect(fixture.pretty('    CacheNewObject\tr0,\tr1, 0,\t0')).toBe(
      fixture.pretty(),
    );
  });

  test('missing shapes and missing keys fail closed', () => {
    const fixture = cachedObject(0);
    expect(() => fixture.pretty('    CacheNewObject r0, r1, 9, 0')).toThrow(
      'undecodable cached object shape',
    );
    fixture.buffers.objectKeys.fill(0);
    expect(() => fixture.pretty()).toThrow('undecodable cached object shape');
  });

  test('unresolved string references still fail closed', () => {
    const fixture = cachedObject(0);
    fixture.strings.clear();
    expect(() => fixture.pretty()).toThrow('unresolved string id 1');
  });

  test.each([
    '    CacheNewObject r0, r1, 0',
    '    CacheNewObject r0, r1, -1, 0',
    '    CacheNewObject r0, r1, 0, 0, 9',
  ])('does not silently fold malformed operands: %s', (line) => {
    expect(() => cachedObject(0).pretty(line)).toThrow(
      'unsupported cached object operands',
    );
  });

  test('the classic split layout cannot resolve a cached-object shape', () => {
    const resolver = new LiteralResolver(
      {
        layout: 'split',
        version: 96,
        array: Buffer.alloc(0),
        objectKeys: Buffer.alloc(0),
        objectValues: Buffer.alloc(0),
      },
      new Map(),
    );
    expect(() =>
      normalizeDisassemblyLine(
        '    CacheNewObject r0, r1, 0, 0',
        new Map(),
        resolver,
      ),
    ).toThrow('undecodable cached object shape');
  });

  test.skipIf(os.platform() === 'win32')(
    'matching folded text without binary data is still unverifiable',
    async () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'rnu-cached-shape-'));
      try {
        const compiler = path.join(dir, 'fake-hermesc');
        writeFileSync(
          compiler,
          `#!${process.execPath}\nconst fs = require('node:fs');\nprocess.stdout.write(fs.readFileSync(process.argv[process.argv.length - 1], 'utf8'));\n`,
          { mode: 0o755 },
        );
        const plain = path.join(dir, 'plain.hbc');
        const delta = path.join(dir, 'delta.hbc');
        const dump = (index: number) =>
          `Function<global>(1 params, 2 registers):\n    CacheNewObject r0, r1, ${index}, 0\n`;
        writeFileSync(plain, dump(0));
        writeFileSync(delta, dump(7));
        const result = await compareHermesBytecode(compiler, delta, plain);
        expect(result.status).toBe('dump-failed');
        expect(result.detail).toContain('text-only comparison cannot verify');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

describe('Hermes fuzz success requires useful coverage', () => {
  const success: HermesFuzzSummary = {
    rounds: 50,
    equivalent: 50,
    different: 0,
    dumpFailed: 0,
    compileErrors: 0,
    planted: 5,
    plantedMissed: 0,
    plantedCompileErrors: 0,
  };

  test('accepts a fully exercised successful run', () => {
    expect(hermesFuzzSucceeded(success)).toBe(true);
  });

  test.each([
    { equivalent: 0, compileErrors: 50, planted: 0 },
    { equivalent: 49, compileErrors: 1 },
    { equivalent: 49 },
    { planted: 0 },
    { plantedMissed: 1 },
    { plantedCompileErrors: 1 },
    { different: 1 },
    { dumpFailed: 1 },
    { rounds: 0, equivalent: 0 },
    { rounds: -1, equivalent: -1 },
    { rounds: 0.5, equivalent: 0.5 },
    { rounds: Number.NaN },
    { rounds: Number.POSITIVE_INFINITY },
  ])('rejects incomplete or invalid results: %j', (override) => {
    expect(hermesFuzzSucceeded({ ...success, ...override })).toBe(false);
  });
});
