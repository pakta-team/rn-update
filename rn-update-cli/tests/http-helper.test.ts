import { afterEach, describe, expect, mock, test } from 'bun:test';

const runtimeFetchMock = mock(() => Promise.resolve({ status: 200 }));
mock.module('../src/utils/runtime', () => ({
  runtimeFetch: runtimeFetchMock,
}));

import { testUrls } from '../src/utils/http-helper';

describe('testUrls', () => {
  test('returns null for empty array', async () => {
    const result = await testUrls([]);
    expect(result).toBeNull();
  });

  test('returns null for undefined', async () => {
    const result = await testUrls(undefined);
    expect(result).toBeNull();
  });
});

describe('testUrls edge cases', () => {
  afterEach(() => {
    runtimeFetchMock.mockReset();
  });

  test('Happy Path: returns successful URL', async () => {
    runtimeFetchMock.mockImplementation((url: string) => {
      if (url === 'http://success.local') {
        return Promise.resolve({ status: 200 });
      }
      return Promise.reject(new Error('fail'));
    });

    const result = await testUrls([
      'http://fail.local',
      'http://success.local',
    ]);
    expect(result).toBe('http://success.local');
  });

  test('Fastest Response: returns the URL that resolves first when all launch together', async () => {
    runtimeFetchMock.mockImplementation((url: string) => {
      if (url === 'http://fast.local') {
        return new Promise((resolve) =>
          setTimeout(() => resolve({ status: 200 }), 10),
        );
      }
      if (url === 'http://slow.local') {
        return new Promise((resolve) =>
          setTimeout(() => resolve({ status: 200 }), 50),
        );
      }
      return Promise.reject(new Error('fail'));
    });

    // hedgeDelayMs 0 launches every url at once — pure race semantics.
    const result = await testUrls(
      ['http://slow.local', 'http://fast.local'],
      0,
    );
    expect(result).toBe('http://fast.local');
  });

  test('Hedged: only pings the first url when it answers within the hedge delay', async () => {
    runtimeFetchMock.mockImplementation(
      () =>
        new Promise((resolve) => setTimeout(() => resolve({ status: 200 }), 5)),
    );

    const result = await testUrls(
      ['http://first.local', 'http://second.local'],
      500,
    );
    expect(result).toBe('http://first.local');
    expect(runtimeFetchMock).toHaveBeenCalledTimes(1);
  });

  test('Hedged: does not wait for a slow first url and aborts the loser', async () => {
    const signals: Record<string, AbortSignal | undefined> = {};
    runtimeFetchMock.mockImplementation(
      (url: string, options?: { signal?: AbortSignal }) =>
        new Promise((resolve, reject) => {
          signals[url] = options?.signal;
          const ms = url === 'http://slow.local' ? 2000 : 10;
          const timer = setTimeout(() => resolve({ status: 200 }), ms);
          options?.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('aborted'));
          });
        }),
    );

    const start = Date.now();
    const result = await testUrls(
      ['http://slow.local', 'http://fast.local'],
      20,
    );
    const elapsed = Date.now() - start;

    expect(result).toBe('http://fast.local');
    // Must complete in roughly hedgeDelay + fast-url time, not 2s.
    expect(elapsed).toBeLessThan(500);
    expect(signals['http://slow.local']?.aborted).toBe(true);
    expect(signals['http://fast.local']?.aborted).toBe(false);
  });

  test('All Failures (Fallback): returns urls[0] without throwing', async () => {
    runtimeFetchMock.mockImplementation(() => {
      return Promise.resolve({ status: 500 });
    });

    const result = await testUrls(['http://fail1.local', 'http://fail2.local']);
    expect(result).toBe('http://fail1.local');
  });

  test('Handles array containing empty strings or malformed URLs', async () => {
    runtimeFetchMock.mockImplementation((url: string) => {
      if (url === 'http://success.local') {
        return Promise.resolve({ status: 200 });
      }
      return Promise.reject(new Error('fail'));
    });

    const result = await testUrls(['', 'invalid-url', 'http://success.local']);
    expect(result).toBe('http://success.local');
  });
});
