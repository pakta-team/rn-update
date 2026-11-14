/**
 * [INPUT]: 依赖 hermes-literals 的 LiteralResolver 与 shape/objectKeys 解码能力
 * [OUTPUT]: 对外提供 normalizeCachedObjectInstruction（CacheNewObject shape 折叠）
 * [POS]: src/utils 的 CacheNewObject 归一化器，被 hermes-base.ts 的 normalizeDisassemblyLine 消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import type { LiteralResolver } from './hermes-literals';

/** Normalize the shape reference, not the registers or the per-function cache. */
export function normalizeCachedObjectInstruction(
  line: string,
  literals?: LiteralResolver,
): string {
  const m =
    /^(\s*)CacheNewObject\s+(r\d+),\s*(r\d+),\s*(\d+),\s*(\d+)\s*$/.exec(line);
  if (!m) throw new Error(`unsupported cached object operands: ${line.trim()}`);
  const prefix = `${m[1]}CacheNewObject ${m[2]}, ${m[3]}, `;
  // Diagnostic-only fallback: compareHermesBytecode still requires readable
  // binary data and a successful raw audit before returning equivalent.
  if (!literals) return `${prefix}<shape>, ${m[5]}`;
  const shape = literals.shape(Number(m[4]));
  const keys = shape && literals.objectKeys(shape.keyOffset, shape.count);
  if (!shape || !keys) {
    throw new Error(`undecodable cached object shape ${m[4]}`);
  }
  // JSON preserves key order, complete string contents and significant spaces.
  return `${prefix}keys=${JSON.stringify(keys)}, ${m[5]}`;
}
