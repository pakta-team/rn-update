/**
 * [INPUT]: 依赖 @babel/parser 的 parse 与字符串字面量遍历
 * [OUTPUT]: 对外提供 FuzzStringLiteral 类型与 fuzzStringLiterals 真实边界变异
 * [POS]: scripts 的模糊测试变异原语，被 fuzz-hermes-base.ts 与其单测消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { parse } from '@babel/parser';

export interface FuzzStringLiteral {
  start: number;
  end: number;
  value: string;
}

/** Locate actual JS strings, never the gap between two closing/opening quotes. */
export function fuzzStringLiterals(source: string): FuzzStringLiteral[] {
  const { tokens } = parse(source, {
    sourceType: 'script',
    tokens: true,
    errorRecovery: true,
  });
  if (!tokens) throw new Error('Parser did not return string-token data');
  const literals: FuzzStringLiteral[] = [];
  for (const token of tokens) {
    if (
      typeof token.type === 'object' &&
      token.type.label === 'string' &&
      typeof token.value === 'string'
    ) {
      literals.push({ start: token.start, end: token.end, value: token.value });
    }
  }
  return literals;
}
