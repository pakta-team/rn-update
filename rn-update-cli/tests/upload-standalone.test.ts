/**
 * [INPUT]: 依赖 standalone 会话 API、共享上传传输与文件范围流
 * [OUTPUT]: 验证代理、期限、重试流重建、进度回滚及 ETag complete/abort 契约
 * [POS]: API 上传边界回归，隔离管理请求和对象传输以检查会话终局
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import fs from 'fs';
import type { Agent } from 'http';
import os from 'os';
import path from 'path';
import type ProgressBar from 'progress';
import { uploadFile, uploadTimeoutMs } from '../src/api';
import * as httpHelper from '../src/utils/http-helper';
import * as runtime from '../src/utils/runtime';
import * as transport from '../src/utils/upload-request';

const file = path.join(os.tmpdir(), `rnu-standalone-${process.pid}.ppk`);
const partSize = 8 << 20;
const content = Buffer.alloc(partSize + 123, 0x5a);
const identity = { key: 'object-key', uploadId: 'upload-1' };
const calls: { url: string; body: any }[] = [];
let spies: { mockRestore(): void }[] = [];

afterEach(() => {
  for (const spy of spies) spy.mockRestore();
  spies = [];
  calls.length = 0;
  fs.rmSync(file, { force: true });
});

function setup(data = content, failRoute?: string) {
  fs.writeFileSync(file, data);
  spies.push(
    spyOn(httpHelper, 'isStandaloneService').mockReturnValue(true),
    spyOn(httpHelper, 'getBaseUrl').mockResolvedValue('http://api.test'),
    spyOn(console, 'warn').mockImplementation(() => {}),
    spyOn(runtime, 'runtimeFetch').mockImplementation(async (url, init) => {
      const body = JSON.parse(init?.body);
      calls.push({ url, body });
      if (failRoute && url.endsWith(failRoute))
        throw new Error('management failed');
      const result = url.endsWith('/parts')
        ? {
            parts: body.partNumbers.map((partNumber: number) => ({
              partNumber,
              url: `https://store.test/${partNumber}`,
            })),
          }
        : url.endsWith('/complete')
          ? { key: identity.key, url: 'https://store.test/object' }
          : identity;
      return {
        status: 200,
        statusText: 'OK',
        text: async () => JSON.stringify({ data: result }),
      };
    }),
  );
}

async function drain(request: transport.UploadRequest) {
  const chunks: Buffer[] = [];
  for await (const chunk of request.body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function terminal(route: string) {
  return calls.filter(({ url }) => url.endsWith(`/${route}`));
}

describe('standalone bounded upload', () => {
  test.each([
    [0, 60_000],
    [-1, 60_000],
    [1, 60_000],
    [1048576, 60_000],
    [6 * 1048576 - 1, 60_000],
    [6 * 1048576, 60_000],
    [6 * 1048576 + 1, 65_000],
    [7 * 1048576, 65_000],
    [7 * 1048576 + 1, 70_000],
    [1024 * 1048576, 5_150_000],
    [1024 * 1048576 + 1, 5_155_000],
  ])('uploadTimeoutMs(%i) returns %i ms', (size, timeout) => {
    expect(uploadTimeoutMs(size)).toBe(timeout);
  });

  test('rebuilds only the failed range, rolls progress back, uses proxy and completes exact ETags', async () => {
    setup();
    const agent = {} as Agent;
    const proxy = spyOn(runtime, 'proxyAgentFor').mockReturnValue(agent);
    const streams: transport.UploadRequest['body'][] = [];
    const bodies: Buffer[] = [];
    const positions: number[] = [];
    const progress = spyOn(
      (await import('progress')).default.prototype,
      'tick',
    ).mockImplementation(function (this: ProgressBar, amount = 1) {
      positions.push(this.curr);
      this.curr += Number(amount);
    });
    spies.push(
      proxy,
      progress,
      spyOn(transport, 'sendUploadRequest').mockImplementation(
        async (url, request, options) => {
          expect(options.agent).toBe(agent);
          expect(options.signal).toBeInstanceOf(AbortSignal);
          expect(options.userAgent).toStartWith('rn-update-cli/');
          expect(request.method).toBe('PUT');
          streams.push(request.body);
          const body = await drain(request);
          bodies.push(body);
          expect(Number(request.headers['content-length'])).toBe(body.length);
          if (bodies.length === 2)
            throw Object.assign(new Error('reset'), { code: 'ECONNRESET' });
          return {
            status: 200,
            statusText: 'OK',
            eTag: `"etag-${url.at(-1)}"`,
          };
        },
      ),
    );
    expect(await uploadFile(file, 'app-1')).toEqual({
      hash: identity.key,
      key: identity.key,
      url: 'https://store.test/object',
    });
    expect(bodies).toEqual([
      content.subarray(0, partSize),
      content.subarray(partSize),
      content.subarray(partSize),
    ]);
    expect(new Set(streams).size).toBe(3);
    expect(positions.at(-1)).toBe(partSize);
    expect(terminal('complete')[0].body).toEqual({
      ...identity,
      parts: [
        { partNumber: 1, eTag: '"etag-1"', size: partSize },
        { partNumber: 2, eTag: '"etag-2"', size: 123 },
      ],
    });
    expect(terminal('abort')).toHaveLength(0);
  });

  test('zero bytes still PUTs an empty part and completes size zero', async () => {
    setup(Buffer.alloc(0));
    spies.push(
      spyOn(runtime, 'proxyAgentFor').mockReturnValue(undefined),
      spyOn(transport, 'sendUploadRequest').mockImplementation(
        async (_url, request) => {
          expect(request.headers['content-length']).toBe('0');
          expect(await drain(request)).toEqual(Buffer.alloc(0));
          return { status: 200, statusText: 'OK', eTag: 'empty' };
        },
      ),
    );
    await uploadFile(file, 'app-1');
    expect(terminal('complete')[0].body.parts).toEqual([
      { partNumber: 1, eTag: 'empty', size: 0 },
    ]);
  });

  test.each(['http', 'etag', 'network'])(
    'partial %s failure aborts once without complete or later parts',
    async (failure) => {
      setup(Buffer.alloc(2 * partSize + 1));
      let attempts = 0;
      spies.push(
        spyOn(runtime, 'proxyAgentFor').mockReturnValue(undefined),
        spyOn(transport, 'sendUploadRequest').mockImplementation(
          async (url, request) => {
            attempts++;
            await drain(request);
            if (url.endsWith('/1'))
              return { status: 200, statusText: 'OK', eTag: 'first' };
            if (failure === 'network')
              throw Object.assign(new Error('reset'), { code: 'ECONNRESET' });
            return {
              status: failure === 'http' ? 403 : 200,
              statusText: '',
              eTag: undefined,
            };
          },
        ),
      );
      await expect(uploadFile(file, 'app-1')).rejects.toThrow();
      expect(attempts).toBe(failure === 'network' ? 3 : 2);
      expect(terminal('complete')).toHaveLength(0);
      expect(terminal('abort').map(({ body }) => body)).toEqual([identity]);
    },
  );

  test('stalled attempts each have a deadline and exhausted retries abort the session', async () => {
    setup(Buffer.from('x'));
    const original = globalThis.setTimeout;
    const deadlines: number[] = [];
    spies.push(
      spyOn(globalThis, 'setTimeout').mockImplementation(((
        callback: (...args: any[]) => void,
        ms?: number,
        ...args: any[]
      ) => {
        if (ms === 60_000) {
          deadlines.push(ms);
          return original(callback, 5, ...args);
        }
        return original(callback, ms, ...args);
      }) as typeof setTimeout),
      spyOn(runtime, 'proxyAgentFor').mockReturnValue(undefined),
      spyOn(transport, 'sendUploadRequest').mockImplementation(
        async (_url, request, options) => {
          await drain(request);
          return new Promise((_resolve, reject) =>
            options.signal?.addEventListener(
              'abort',
              () =>
                reject(
                  Object.assign(new Error('aborted'), { name: 'AbortError' }),
                ),
              { once: true },
            ),
          );
        },
      ),
    );
    await expect(uploadFile(file, 'app-1')).rejects.toMatchObject({
      name: 'UploadTimeoutError',
      code: 'ETIMEDOUT',
    });
    expect(deadlines).toEqual([60_000, 60_000]);
    expect(terminal('abort').map(({ body }) => body)).toEqual([identity]);
    expect(terminal('complete')).toHaveLength(0);
  });

  test.each(['/parts', '/complete'])(
    'management %s failure preserves its error and aborts the created session',
    async (route) => {
      setup(Buffer.from('x'), route);
      spies.push(
        spyOn(runtime, 'proxyAgentFor').mockReturnValue(undefined),
        spyOn(transport, 'sendUploadRequest').mockImplementation(
          async (_url, request) => {
            await drain(request);
            return { status: 200, statusText: 'OK', eTag: 'etag' };
          },
        ),
      );
      await expect(uploadFile(file, 'app-1')).rejects.toThrow(
        'management failed',
      );
      expect(terminal('abort').map(({ body }) => body)).toEqual([identity]);
    },
  );
});
