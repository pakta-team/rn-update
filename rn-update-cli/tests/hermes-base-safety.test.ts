/**
 * [INPUT]: 依赖 Hermes pretty 反汇编归一化函数
 * [OUTPUT]: 验证语义操作数、分支目标和引号内空白不会被错误折叠
 * [POS]: CLI Hermes 等价校验的安全负例回归，独立于真实编译器
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { describe, expect, test } from 'bun:test';
import { normalizeDisassemblyLine } from '../src/utils/hermes-base';

const normalize = (line: string) =>
  normalizeDisassemblyLine(line, new Map<number, string>());

describe('Hermes-base normalization must retain semantic differences', () => {
  test('does not collapse spaces inside a string literal', () => {
    expect(normalize('    LoadConstString r0, "a  b"')).not.toBe(
      normalize('    LoadConstString r0, "a b"'),
    );
  });

  test('does not erase a changed branch destination', () => {
    // In a whole-function regression both labels should already exist and
    // retain their locations; retarget a later branch between those labels.
    expect(normalize('    JmpTrue L1, r0')).not.toBe(
      normalize('    JmpTrue L2, r0'),
    );
  });

  test('negative control: different register operands remain different', () => {
    expect(normalize('    Add r0, r1, r2')).not.toBe(
      normalize('    Add r0, r1, r3'),
    );
  });

  test('positive control: column padding outside literals may be folded', () => {
    expect(normalize('    LoadConstString       r0, "same"')).toBe(
      normalize('    LoadConstString r0, "same"'),
    );
  });
});

/** Previous spacing implementation, kept as an independent compatibility oracle. */
function referenceSpacing(text: string): string {
  let result = '';
  let quoted = false;
  let escaped = false;
  let spacing = false;
  for (const char of text) {
    if (quoted) {
      result += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (/\s/.test(char)) {
      if (!spacing) result += ' ';
      spacing = true;
    } else {
      result += char;
      spacing = false;
      if (char === '"') quoted = true;
    }
  }
  return result;
}

describe('Hermes operand spacing compatibility', () => {
  test('matches the previous whitespace behavior for every UTF-16 code unit', () => {
    const mismatches: number[] = [];
    for (let code = 0; code <= 0xffff; code++) {
      const operands = ` r0, ${String.fromCharCode(code)} r1`;
      if (
        normalize(`    Mov${operands}`) !==
        `    Mov${referenceSpacing(operands)}`
      ) {
        mismatches.push(code);
      }
    }
    expect(mismatches).toEqual([]);
  });

  test('preserves whitespace, escapes and surrogate pairs inside quotes', () => {
    const whitespace =
      '\t\n\v\f\r \u00a0\u1680\u2000\u2028\u2029\u202f\u205f\u3000\ufeff';
    const operands = [
      ` r0, "a${whitespace}b"`,
      String.raw` r0, "a\"  b\\  c",  r1`,
      ` r0, "😀  𠮷\ud800\udfff",\u00a0\ufeffr1`,
      ' r0, \u0085\u180e\u200b r1',
    ];
    for (const operand of operands) {
      expect(normalize(`    Mov${operand}`)).toBe(
        `    Mov${referenceSpacing(operand)}`,
      );
    }
  });
});
