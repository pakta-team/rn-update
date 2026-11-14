import { describe, expect, test } from 'bun:test';
import cliConfig from '../cli.json';

const cliArguments: {
  parse: (
    config: Record<string, unknown>,
    argv: string[],
  ) => { command: string; options: Record<string, unknown>; args: string[] };
} = require('cli-arguments');

describe('cli.json options', () => {
  test('bundle accepts Sentry source map upload options', () => {
    const parsed = cliArguments.parse(cliConfig, [
      'bundle',
      '--sentry-release',
      'com.example@1.0.0+1+pakta:hash',
      '--sentry-dist',
      'pakta:hash',
    ]);

    expect(parsed.command).toBe('bundle');
    expect(parsed.options).toEqual(
      expect.objectContaining({
        'sentry-release': 'com.example@1.0.0+1+pakta:hash',
        'sentry-dist': 'pakta:hash',
      }),
    );
  });
});
