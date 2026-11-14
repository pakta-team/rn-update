import { describe, expect, test } from 'bun:test';
import { normalizeDisassemblyLine } from '../src/utils/hermes-base';

const normalize = (line: string) =>
  normalizeDisassemblyLine(line, new Map<number, string>());

describe('Hermes switch jump-table normalization', () => {
  test('normalizes only the StringSwitchImm jump-table offset', () => {
    const baseline = normalize('    StringSwitchImm r13, 2, 4024, L146, 150');
    expect(baseline).toBe('    StringSwitchImm r13, 2, <jt>, L146, 150');
    expect(normalize('    StringSwitchImm r13, 2, 4025, L146, 150')).toBe(
      baseline,
    );
    expect(normalize('    StringSwitchImm r13, 3, 4024, L146, 150')).not.toBe(
      baseline,
    );
    expect(normalize('    StringSwitchImm r13, 2, 4024, L147, 150')).not.toBe(
      baseline,
    );
    expect(normalize('    StringSwitchImm r13, 2, 4024, L146, 151')).not.toBe(
      baseline,
    );
  });

  test('normalizes only the UIntSwitchImm jump-table offset', () => {
    const baseline = normalize('    UIntSwitchImm r40, 5937, L3, 0, 31');
    expect(baseline).toBe('    UIntSwitchImm r40, <jt>, L3, 0, 31');
    expect(normalize('    UIntSwitchImm r40, 5938, L3, 0, 31')).toBe(baseline);
    expect(normalize('    UIntSwitchImm r40, 5937, L4, 0, 31')).not.toBe(
      baseline,
    );
    expect(normalize('    UIntSwitchImm r40, 5937, L3, 1, 31')).not.toBe(
      baseline,
    );
    expect(normalize('    UIntSwitchImm r40, 5937, L3, 0, 32')).not.toBe(
      baseline,
    );
  });

  test('does not fold unsupported or malformed switch shapes', () => {
    expect(normalize('    SwitchImm r1, 2, 3, L4, 5')).toBe(
      '    SwitchImm r1, 2, 3, L4, 5',
    );
    expect(normalize('    UIntSwitchImm r40, 5937, 3, 0, 31')).toBe(
      '    UIntSwitchImm r40, 5937, 3, 0, 31',
    );
  });
});
