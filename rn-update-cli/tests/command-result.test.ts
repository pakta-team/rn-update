import { describe, expect, test } from 'bun:test';
import {
  runAsCommandResult,
  toErrorMessage,
} from '../src/utils/command-result';

describe('utils/command-result', () => {
  test('toErrorMessage uses Error.message when possible', () => {
    expect(toErrorMessage(new Error('boom'), 'fallback')).toBe('boom');
  });

  test('toErrorMessage falls back for non-Error values', () => {
    expect(toErrorMessage('boom', 'fallback')).toBe('fallback');
    expect(toErrorMessage({ message: 'boom' }, 'fallback')).toBe('fallback');
  });

  test('runAsCommandResult returns success with raw data', async () => {
    const result = await runAsCommandResult(async () => 123, 'failed');
    expect(result).toEqual({
      success: true,
      data: 123,
    });
  });

  test('runAsCommandResult maps successful data when mapper provided', async () => {
    const result = await runAsCommandResult(
      async () => ({ id: 1, name: 'pkg' }),
      'failed',
      (value) => ({ label: `${value.id}-${value.name}` }),
    );
    expect(result).toEqual({
      success: true,
      data: { label: '1-pkg' },
    });
  });

  test('runAsCommandResult returns thrown Error message', async () => {
    const result = await runAsCommandResult(async () => {
      throw new Error('api failed');
    }, 'fallback');
    expect(result).toEqual({
      success: false,
      error: 'api failed',
    });
  });

  test('runAsCommandResult returns fallback for non-Error throw', async () => {
    const result = await runAsCommandResult(async () => {
      throw 'failed';
    }, 'fallback');
    expect(result).toEqual({
      success: false,
      error: 'fallback',
    });
  });
});
