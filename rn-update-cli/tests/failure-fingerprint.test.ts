/**
 * [INPUT]: 依赖 src/utils/failure-fingerprint 的 redactFailureDetail 与 failureFingerprint
 * [OUTPUT]: 验证脱敏保形（寄存器/计数保留）、标识符全抹、指纹跨表达稳定与相异输入不同指纹
 * [POS]: tests 的指纹单测，锁死“指纹只有一份实现”的语义契约
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { describe, expect, test } from 'bun:test';
import {
  failureFingerprint,
  redactFailureDetail,
} from '../src/utils/failure-fingerprint';

// The detail of a rejected Hermes base, in the shape the comparison emits.
const REJECTED =
  'Function<h>(3 params, 21 registers, 1 numbers, 2 non-pointers): +72: ' +
  'DefineOwnById r3, r6, 1, "shipmentTrackingR"... vs ' +
  'DefineOwnById r3, r6, 1, "shipmentTrackingReference"';

describe('redactFailureDetail', () => {
  test('keeps the shape and drops every name that comes from user code', () => {
    const redacted = redactFailureDetail(REJECTED);
    expect(redacted).not.toContain('shipmentTracking');
    expect(redacted).not.toContain('Function<h>');
    // what a fix is reasoned about survives
    expect(redacted).toContain('DefineOwnById r3, r6, 1,');
    expect(redacted).toContain('+72:');
    // each redacted value keeps its length, so a truncated operand still
    // reads as the shorter one
    expect(redacted).toContain('/17');
    expect(redacted).toContain('/25');
  });

  test('marks non-ASCII strings without revealing them', () => {
    const redacted = redactFailureDetail(
      'Array Buffer entry 1: [String "中文属性名"] vs [String "bar"]',
    );
    expect(redacted).not.toContain('中文');
    expect(redacted).toContain('/5/u16');
    expect(redacted).toContain('/3');
  });

  test('strips paths that reach the line through a compiler stderr', () => {
    const redacted = redactFailureDetail(
      'base dump: exit 3: boom: /Users/someone/app/build/delta.hbc',
    );
    expect(redacted).not.toContain('someone');
    expect(redacted).toContain('.hbc');
    expect(redacted).toContain('exit 3');
  });

  test('the same value always redacts to the same token', () => {
    expect(redactFailureDetail(REJECTED)).toBe(redactFailureDetail(REJECTED));
  });
});

describe('failureFingerprint', () => {
  test('groups the same defect across apps, registers and ids', () => {
    const otherApp = REJECTED.replace(/shipmentTracking/g, 'promotionRequest')
      .replace('r3, r6', 'r9, r2')
      .replace('+72', '+8');
    expect(failureFingerprint(otherApp)).toBe(failureFingerprint(REJECTED));
  });

  test('the jump-table offsets of one SwitchImm gap are one group', () => {
    const at = (offset: number) =>
      `Function<ui>(4 params, 21 registers, 0 symbols): +5: SwitchImm r0, ${offset}, L4, 3, 31 vs SwitchImm r0, 616, L4, 3, 31`;
    expect(failureFingerprint(at(620))).toBe(failureFingerprint(at(618)));
  });

  test('a different instruction is a different group', () => {
    expect(failureFingerprint(REJECTED)).not.toBe(
      failureFingerprint(REJECTED.replace(/DefineOwnById/g, 'PutByIdLoose')),
    );
  });

  test('is 32 hex characters, as the server column stores it', () => {
    expect(failureFingerprint(REJECTED)).toMatch(/^[0-9a-f]{32}$/);
  });
});
