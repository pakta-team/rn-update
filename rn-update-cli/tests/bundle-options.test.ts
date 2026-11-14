import { describe, expect, test } from 'bun:test';
import { bundleCommands, normalizeBundleOptions } from '../src/bundle';
import { tempDir } from '../src/utils/constants';

describe('normalizeBundleOptions', () => {
  test('applies defaults for android', () => {
    const normalized = normalizeBundleOptions({}, 'android');
    expect(normalized.bundleName).toBe('index.bundlejs');
    expect(normalized.entryFile).toBe('index.js');
    expect(normalized.intermediaDir).toBe(`${tempDir}/intermedia/android`);
    expect(normalized.output).toBe(`${tempDir}/output/android.\${time}.ppk`);
    expect(normalized.dev).toBe('false');
    // archived with the published version by default (pakta symbolicate)
    expect(normalized.sourcemap).toBe(true);
    expect(normalized.dryRun).toBe(false);
  });

  test('forces harmony bundleName regardless of the option', () => {
    const normalized = normalizeBundleOptions(
      { bundleName: 'custom.bundle' },
      'harmony',
    );
    expect(normalized.bundleName).toBe('bundle.harmony.js');
  });

  test('respects custom bundleName on other platforms', () => {
    const normalized = normalizeBundleOptions(
      { bundleName: 'custom.bundle' },
      'ios',
    );
    expect(normalized.bundleName).toBe('custom.bundle');
  });

  test('accepts both sentry option spellings', () => {
    expect(
      normalizeBundleOptions({ 'sentry-release': 'r1' }, 'ios').sentryRelease,
    ).toBe('r1');
    expect(
      normalizeBundleOptions({ sentryRelease: 'r2' }, 'ios').sentryRelease,
    ).toBe('r2');
    expect(
      normalizeBundleOptions({ 'sentry-dist': 'd1' }, 'ios').sentryDist,
    ).toBe('d1');
    expect(normalizeBundleOptions({ sentryDist: 'd2' }, 'ios').sentryDist).toBe(
      'd2',
    );
  });

  test('resetCache defaults on and can be switched off', () => {
    expect(normalizeBundleOptions({}, 'android').resetCache).toBe(true);
    expect(
      normalizeBundleOptions({ resetCache: 'false' }, 'android').resetCache,
    ).toBe(false);
    expect(
      normalizeBundleOptions({ resetCache: false }, 'ios').resetCache,
    ).toBe(false);
  });

  test('normalizes dev flag to a string', () => {
    expect(normalizeBundleOptions({ dev: true }, 'android').dev).toBe('true');
    expect(normalizeBundleOptions({ dev: false }, 'android').dev).toBe('false');
  });

  test('--no-sourcemap switches the map off', () => {
    // cli-arguments implements `--no-<flag>` by clearing the flag's value: the
    // key stays in the parsed options as undefined
    expect(
      normalizeBundleOptions({ sourcemap: undefined }, 'android').sourcemap,
    ).toBe(false);
    expect(
      normalizeBundleOptions({ sourcemap: false }, 'android').sourcemap,
    ).toBe(false);
    expect(
      normalizeBundleOptions({ sourcemap: true }, 'android').sourcemap,
    ).toBe(true);
  });
});

describe('bundleCommands.bundle arguments', () => {
  test('rejects stray positional arguments such as `--sourcemap false`', async () => {
    // a boolean flag takes no value, so "false" would become a positional
    // argument and the flag would silently stay on
    await expect(
      bundleCommands.bundle({ args: ['false'], options: { platform: 'ios' } }),
    ).rejects.toThrow(/--no-sourcemap/);
  });
});
