/**
 * [INPUT]: 依赖 @babel/parser 与 scripts/hermes-fuzz-literals 的 fuzzStringLiterals
 * [OUTPUT]: 验证变异点全部落在真实字符串字面量边界内（转义引号不越界）
 * [POS]: tests 的变异原语回归，源自 HBC 96 seed 96 round 41 的最小复现
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { describe, expect, test } from 'bun:test';
import { parse } from '@babel/parser';
import { fuzzStringLiterals } from '../scripts/hermes-fuzz-literals';

describe('Hermes fuzz mutations use actual string boundaries', () => {
  test('escaped quotes cannot turn a gap into an invalid property name', () => {
    // Minimized from HBC 96, seed 96, round 41. The old regex matched
    // `", b: 1, "` and inserted ~ outside the following property-name string.
    const source = String.raw`var o = {a: "text\n\t\"quoted\"", b: 1, "flag-beta.map": "value"};`;
    const literals = fuzzStringLiterals(source);
    expect(literals.map((literal) => literal.value)).toEqual([
      'text\n\t"quoted"',
      'flag-beta.map',
      'value',
    ]);
    for (const literal of literals) {
      const changed =
        source.slice(0, literal.start) +
        JSON.stringify(`${literal.value}~`) +
        source.slice(literal.end);
      expect(() => parse(changed)).not.toThrow();
    }
  });

  test('ignores quotes in comments, regexps and template text', () => {
    const source = [
      '// "comment"',
      String.raw`const pattern = /["'\d]/;`,
      // biome-ignore lint/suspicious/noTemplateCurlyInString: JS source fixture.
      'const template = `text "raw" ${"actual"}`;',
    ].join('\n');
    const values = fuzzStringLiterals(source).map((literal) => literal.value);
    expect(values).toEqual(['actual']);
  });

  test('retains UTF-16 source offsets and decodes escaped values', () => {
    // Use a cooked string: Bun may escape non-ASCII in a tagged raw template.
    const source = 'var x = "😀"; var y = "\\u4e2d";';
    const literals = fuzzStringLiterals(source);
    expect(literals.map((literal) => literal.value)).toEqual(['😀', '中']);
    const spellings = literals.map(({ start, end }) =>
      source.slice(start, end),
    );
    expect(spellings).toEqual(['"😀"', '"\\u4e2d"']);
  });
});
