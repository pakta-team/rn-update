/**
 * [INPUT]: 依赖真实 Hermes 编译器、HBC 二进制数据与 raw dump 审计器
 * [OUTPUT]: 验证完整字符串、函数引用、double、BigInt、switch 和函数头语义差异可被发现
 * [POS]: CLI Hermes 无损操作数审计的真实编译器回归，缺少 hermesc 时安全跳过
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { removeSync } from '../src/utils/fs-helpers';
import {
  compareHermesBytecode,
  probeHbcVersion,
} from '../src/utils/hermes-base';
import { readLiteralBuffers } from '../src/utils/hermes-literals';
import {
  auditRawHermesBytecode,
  readHermesSemanticData,
} from '../src/utils/hermes-raw';

const hermesc = process.env.HERMESC;
const hasHermesc = Boolean(hermesc && fs.existsSync(hermesc));
const widths: Record<string, number> = {
  Reg8: 1,
  Reg32: 4,
  UInt8: 1,
  UInt16: 2,
  UInt32: 4,
  Addr8: 1,
  Addr32: 4,
  Imm32: 4,
  Double: 8,
};

// Unlike a source-only mutation, changing an HBC operand leaves every function
// body/string table entry in place. This directly tests reference integrity.
describe.if(hasHermesc)('lossless Hermes operand audit (real compiler)', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rnu-hermes-raw-'));
  });
  afterEach(() => removeSync(dir));

  const compile = (
    name: string,
    source: string,
    base?: string,
    extra: string[] = [],
  ) => {
    const input = path.join(dir, `${name}.js`);
    const output = path.join(dir, `${name}.hbc`);
    fs.writeFileSync(input, source);
    const result = spawnSync(
      hermesc!,
      [
        '-emit-binary',
        '-O',
        '-w',
        '-output-source-map',
        '-out',
        output,
        input,
        ...(base ? [`-base-bytecode=${base}`] : []),
        ...extra,
      ],
      { encoding: 'utf8', timeout: 10_000 },
    );
    expect(result.status, result.stderr).toBe(0);
    return output;
  };
  const dump = (file: string, pretty: boolean) => {
    const result = spawnSync(
      hermesc!,
      ['-b', '-dump-bytecode', `-pretty-disassemble=${pretty}`, file],
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 10_000 },
    );
    expect(result.status, result.stderr).toBe(0);
    return result.stdout;
  };
  const rewrite = (file: string, bytes: Buffer) => {
    // Preserve the HBC integrity footer; only the selected semantic value changes.
    createHash('sha1')
      .update(bytes.subarray(0, -20))
      .digest()
      .copy(bytes, bytes.length - 20);
    const changed = `${file}.changed`;
    fs.writeFileSync(changed, bytes);
    return changed;
  };
  const operands = async (file: string, matches: (op: string) => boolean) => {
    const data = await readHermesSemanticData(file);
    let functionIndex = -1;
    const found: {
      opcode: string;
      positions: number[];
      values: number[];
      types: string[];
    }[] = [];
    for (const line of dump(file, false).split('\n')) {
      if (/^(?:Function|NCFunction|Constructor)</.test(line)) functionIndex++;
      const m = /^\[@ (\d+)\] (\w+)(.*)$/.exec(line);
      if (!m || !matches(m[2])) continue;
      let position = data.functions[functionIndex].offset + Number(m[1]) + 1;
      const positions: number[] = [];
      const values: number[] = [];
      const types: string[] = [];
      for (const operand of m[3].matchAll(/([^,<>]+)<(\w+)>/g)) {
        positions.push(position);
        values.push(Number(operand[1].trim()));
        types.push(operand[2]);
        position += widths[operand[2]];
      }
      found.push({ opcode: m[2], positions, values, types });
    }
    return { data, found };
  };

  test.each([
    [
      'long ASCII',
      'common-prefix-longer-than-the-pretty-limit-A',
      'common-prefix-longer-than-the-pretty-limit-B',
    ],
    ['UTF-16', '中华人民共和国教育科学研究甲', '中华人民共和国教育科学研究乙'],
    ['literal escape versus control byte', '\\x00', '\u0000'],
    ['significant whitespace', 'a  b', 'a b'],
    ['escaped quote and whitespace', 'prefix"a  b', 'prefix"a b'],
  ])('%s strings must compare by full value', async (_name, left, right) => {
    const a = compile('a', `globalThis.value = ${JSON.stringify(left)};`);
    const b = compile('b', `globalThis.value = ${JSON.stringify(right)};`);
    expect((await compareHermesBytecode(hermesc!, a, b)).status).toBe(
      'different',
    );
  });

  test.skipIf(!hasHermesc || probeHbcVersion(hermesc!) >= 98)(
    'classic global lexical declarations resolve restricted-property string IDs',
    async () => {
      const base = compile('lexical-base', 'print("old-base-string");');
      const source =
        'let sharedPrefixGlobalLexical = "value"; print(sharedPrefixGlobalLexical);';
      const plain = compile('lexical-plain', source, undefined, [
        '-block-scoping',
      ]);
      const delta = compile('lexical-delta', source, base, ['-block-scoping']);
      const op = /ThrowIfHasRestrictedGlobalProperty (\d+)<UInt32>/;
      const plainId = op.exec(dump(plain, false));
      const deltaId = op.exec(dump(delta, false));
      expect(plainId).not.toBeNull();
      expect(deltaId).not.toBeNull();
      expect(plainId![1]).not.toBe(deltaId![1]);
      const result = await compareHermesBytecode(hermesc!, delta, plain);
      expect(result.status, result.detail).toBe('equivalent');
    },
  );

  test('same-name closures cannot hide a changed function reference', async () => {
    const file = compile(
      'closures',
      'globalThis.fs = [function same(){print(1);}, function same(){print(2);}];',
    );
    const { data, found } = await operands(file, (op) =>
      op.startsWith('CreateClosure'),
    );
    const candidates = found.filter(
      (inst) =>
        JSON.parse(data.functions[inst.values[2]].metadata)[0] === 'same',
    );
    expect(candidates).toHaveLength(2);
    const [first, second] = candidates;
    const bytes = Buffer.from(data.bytes);
    bytes.writeUIntLE(
      second.values[2],
      first.positions[2],
      widths[first.types[2]],
    );
    const changed = rewrite(file, bytes);
    expect(dump(changed, true)).toBe(dump(file, true));
    const result = await compareHermesBytecode(hermesc!, changed, file);
    expect(result.status).toBe('different');
    expect(result.detail).toContain('raw instruction');
  });

  test('the IEEE-754 sign of zero is retained even when both dumps print 0', async () => {
    const file = compile('zero', 'globalThis.x = -0;');
    const { data, found } = await operands(
      file,
      (op) => op === 'LoadConstDouble',
    );
    expect(found.length).toBeGreaterThan(0);
    const bytes = Buffer.from(data.bytes);
    bytes.writeDoubleLE(0, found[0].positions[1]);
    const changed = rewrite(file, bytes);
    expect(dump(changed, true)).toBe(dump(file, true));
    const result = await compareHermesBytecode(hermesc!, changed, file);
    expect(result.status).toBe('different');
    expect(result.detail).toContain('raw instruction');
  });

  test('long BigInts differ after the human-readable prefix', async () => {
    const prefix = '1234567890'.repeat(30);
    const a = compile('big-a', `globalThis.x = ${prefix}1n;`);
    const b = compile('big-b', `globalThis.x = ${prefix}2n;`);
    expect((await compareHermesBytecode(hermesc!, a, b)).status).toBe(
      'different',
    );
  });

  test('header runtime flags are checked rather than discarded with debug metadata', async () => {
    const file = compile(
      'strictness',
      'globalThis.x = function f(){return this;};',
    );
    const data = await readHermesSemanticData(file);
    const bytes = Buffer.from(data.bytes);
    const entrySize = data.version === 98 ? 12 : 16;
    bytes[128 + entrySize - 1] ^= 4; // global function strictMode
    const result = await compareHermesBytecode(
      hermesc!,
      rewrite(file, bytes),
      file,
    );
    expect(result.status).toBe('different');
  });

  test('switch tables remain equivalent against a foreign base', async () => {
    const base = compile(
      'base',
      `globalThis.strings = ${JSON.stringify(Array.from({ length: 400 }, (_, i) => `foreign${i}`))};`,
    );
    const numbers = Array.from(
      { length: 150 },
      (_, i) => `case ${i}: return ${i * i + 19};`,
    ).join('\n');
    const strings = Array.from(
      { length: 100 },
      (_, i) => `case 'common-prefix-long-string-${i}': return ${i * i + 31};`,
    ).join('\n');
    const source = `globalThis.n = function(x){switch(x){${numbers} default: return -1;}};\nglobalThis.s = function(x){switch(x){${strings} default: return -2;}};`;
    const plain = compile('plain', source);
    const delta = compile('delta', source, base);
    expect((await compareHermesBytecode(hermesc!, delta, plain)).status).toBe(
      'equivalent',
    );
  });

  // The pretty pass folds the jump-table offset of (UInt)SwitchImm because a
  // foreign base shifts it (v96 prints the classic `SwitchImm` name, which
  // v2.26.1 missed and rejected good bases for). Folding the offset must not
  // fold what the table holds: swapping two case targets in the delta build
  // keeps every instruction byte and still has to be rejected.
  test('a folded switch offset still compares the jump-table targets', async () => {
    const base = compile(
      'switch-base',
      `globalThis.strings = ${JSON.stringify(Array.from({ length: 400 }, (_, i) => `foreign${i}`))};`,
    );
    const cases = Array.from(
      { length: 32 },
      (_, i) => `case ${i}: return o.k${i} + "v${i}";`,
    ).join('\n');
    const source = `globalThis.oi = function oi(x, o, a){ var t = o.alpha + a.beta; switch(x){${cases} default: return t;}};`;
    const plain = compile('switch-plain', source);
    const delta = compile('switch-delta', source, base);
    const isSwitch = (op: string) =>
      op === 'SwitchImm' || op === 'UIntSwitchImm';
    const [plainSwitch] = (await operands(plain, isSwitch)).found;
    const { data, found } = await operands(delta, isSwitch);
    expect(found).toHaveLength(1);
    const [inst] = found;
    // the offset really moved, so the fold is what makes these equivalent
    expect(inst.values[1]).not.toBe(plainSwitch.values[1]);
    const unchanged = await compareHermesBytecode(hermesc!, delta, plain);
    expect(unchanged.status, unchanged.detail).toBe('equivalent');

    // table entries are Int32 targets relative to the instruction, 4-byte aligned
    const start = Math.ceil((inst.positions[0] - 1 + inst.values[1]) / 4) * 4;
    const bytes = Buffer.from(data.bytes);
    const first = bytes.readInt32LE(start);
    const sixth = bytes.readInt32LE(start + 20);
    expect(first).not.toBe(sixth);
    bytes.writeInt32LE(sixth, start);
    bytes.writeInt32LE(first, start + 20);
    const swapped = rewrite(delta, bytes);
    // the pretty pass already catches it by the table's label order...
    const result = await compareHermesBytecode(hermesc!, swapped, plain);
    expect(result.status).toBe('different');
    // ...and the raw audit, which decodes the targets from the binary table,
    // must reject it on its own too
    const files: [string, string] = [swapped, plain];
    const audit = await auditRawHermesBytecode(
      hermesc!,
      files,
      [
        await readHermesSemanticData(swapped),
        await readHermesSemanticData(plain),
      ],
      [
        (await readLiteralBuffers(swapped))!,
        (await readLiteralBuffers(plain))!,
      ],
      new AbortController().signal,
    );
    expect(audit.status).toBe('different');
    expect(audit.detail).toContain('raw instruction');
  });

  // hermesc annotates the string operand of DefineOwnByIdLong but not of
  // DefineOwnById, so the same instruction prints the text in one build and a
  // bare id in the other -- and pretty output cuts that text to a display
  // budget. A base whose string table spills past 16 bits makes the delta
  // build take the Long form, which used to read as a difference and threw
  // away a good base for any property name longer than the budget.
  // v96 and older print the text for both widths of PutNewOwnById, so only
  // v98's DefineOwnById carries the asymmetry.
  test.skipIf(!hasHermesc || probeHbcVersion(hermesc!) !== 98)(
    'a wide DefineOwnById against a foreign base is not a difference',
    async () => {
      const base = compile(
        'wide-base',
        Array.from(
          { length: 70000 },
          (_, i) => `globalThis.s${i} = "base string ${i}";`,
        ).join('\n'),
      );
      // longer than hermesc's display budget, so the Long form prints a cut
      // name where the short form prints the id
      const name = 'equivalenceCheckPropertyName';
      const source = `globalThis.h = function h(s, v){ return {...s, ${name}: v, b: 1}; };`;
      const plain = compile('wide-plain', source);
      const delta = compile('wide-delta', source, base);
      const pretty = (file: string) =>
        dump(file, true)
          .split('\n')
          .filter((line) => line.includes('DefineOwnById'));
      // the renderings really are the two the fold has to bridge
      expect(pretty(delta)[0]).toContain('DefineOwnByIdLong');
      expect(pretty(delta)[0]).toContain(`"${name.slice(0, 17)}"...`);
      expect(pretty(plain)[0]).not.toContain(name.slice(0, 17));
      const result = await compareHermesBytecode(hermesc!, delta, plain);
      expect(result.status, result.detail).toBe('equivalent');
    },
    30_000,
  );

  test('a property name past the pretty limit still has to match', async () => {
    const object = (name: string) =>
      `globalThis.h = function h(s, v){ return {...s, ${name}: v}; };`;
    const a = compile('name-a', object('equivalenceCheckPropertyNameAlpha'));
    const b = compile('name-b', object('equivalenceCheckPropertyNameBeta'));
    const result = await compareHermesBytecode(hermesc!, a, b);
    expect(result.status).toBe('different');
    expect(result.detail).toContain('raw instruction');
  });

  test('overflow function headers retain the same runtime fields', async () => {
    const base = compile('header-base', 'globalThis.old = "older strings";');
    const params = Array.from({ length: 140 }, (_, i) => `p${i}`).join(',');
    const source = `globalThis.f = function many(${params}){print(p0, p139);};`;
    const plain = compile('header-plain', source);
    const delta = compile('header-delta', source, base);
    expect((await compareHermesBytecode(hermesc!, delta, plain)).status).toBe(
      'equivalent',
    );
  });

  test('truncated raw output is unverifiable, not equivalent', async () => {
    const file = compile('short', 'globalThis.x = "hello";');
    const wrapper = path.join(dir, 'short-dump');
    fs.writeFileSync(
      wrapper,
      `#!/bin/sh\ncase "$*" in *pretty-disassemble=false*) echo 'Function<global>(1 params, 3 registers):'; exit 0;; esac\nexec "${hermesc}" "$@"\n`,
      { mode: 0o755 },
    );
    const result = await compareHermesBytecode(wrapper, file, file);
    expect(result.status).toBe('dump-failed');
    expect(result.detail).toContain('raw dump ended before');
  });

  test('the deadline also covers the second, raw dump pass', async () => {
    const file = compile('raw-timeout', 'print(1);');
    const wrapper = path.join(dir, 'raw-hangs');
    fs.writeFileSync(
      wrapper,
      `#!/bin/sh\ncase "$*" in *pretty-disassemble=false*) exec "${process.execPath}" -e 'setInterval(() => {}, 1000)';; esac\nexec "${hermesc}" "$@"\n`,
      { mode: 0o755 },
    );
    const result = await compareHermesBytecode(wrapper, file, file, {
      timeoutMs: 100,
    });
    expect(result.status).toBe('dump-failed');
  }, 2000);

  test('an unreadable debug-dump destination fails safely', async () => {
    const file = compile('debug-output', 'print(1);');
    const result = await compareHermesBytecode(hermesc!, file, file, {
      dumpTo: { withBase: dir, plain: dir },
      timeoutMs: 1000,
    });
    expect(result.status).toBe('dump-failed');
  });
});
