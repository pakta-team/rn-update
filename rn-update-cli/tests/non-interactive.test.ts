import { describe, expect, test } from 'bun:test';
import { isNonInteractive } from '../src/utils';

describe('isNonInteractive', () => {
  test('treats non-TTY stdin as non-interactive without an explicit flag', () => {
    expect(isNonInteractive({}, false, false)).toBe(true);
  });

  test('allows prompts only with a TTY and no non-interactive flag', () => {
    expect(isNonInteractive({}, true, false)).toBe(false);
  });

  test('honors the environment and global flags', () => {
    expect(isNonInteractive({ NO_INTERACTIVE: '1' }, true, false)).toBe(true);
    expect(isNonInteractive({}, true, true)).toBe(true);
  });
});
