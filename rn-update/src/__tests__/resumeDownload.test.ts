import { beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = fileURLToPath(new URL('../../', import.meta.url));
const windows = process.platform === 'win32';
const nativeRoot = windows
  ? `/mnt/${root[0].toLowerCase()}${root.slice(2).replaceAll('\\', '/')}`
  : root;
const binary = resolve(root, '.tmp/resume-core-tests/resume_plan_test');
const prefix = windows ? ['-d', 'Ubuntu', '--'] : [];
beforeAll(() => {
  const result = spawnSync(
    windows ? 'wsl' : 'sh',
    windows
      ? [...prefix, 'sh', `${nativeRoot}/scripts/test-resume-core.sh`]
      : [`${root}/scripts/test-resume-core.sh`],
    { encoding: 'utf8' }
  );
  if (result.status !== 0)
    throw new Error(result.stderr || 'resume core build failed');
}, 30000);

const source = readFileSync(
  new URL('../../harmony/pakta/src/main/ets/DownloadTask.ts', import.meta.url),
  'utf8'
)
  .replace(/^import[\s\S]*?;\r?\n/gm, '')
  .replace(/^export /gm, '');
const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(source);
const url = 'https://cdn.example.com/a.ppk';
const target = '/data/a.ppk';

function native(op: string, args: unknown[]) {
  const result = spawnSync(
    windows ? 'wsl' : binary,
    windows
      ? [
          ...prefix,
          `${nativeRoot}/.tmp/resume-core-tests/resume_plan_test`,
          '--rpc',
        ]
      : ['--rpc'],
    { input: JSON.stringify({ op, args }), encoding: 'utf8' }
  );
  if (result.status !== 0)
    throw new Error(result.stderr || 'native resume core unavailable');
  return result.stdout;
}

interface Reply {
  status: number;
  body: string;
  range?: string;
  length?: number;
  encoding?: string;
}

function load(replies: Reply[], partial = 'abc') {
  const files = new Map<string, Uint8Array>([
    [target, new TextEncoder().encode(partial)],
    [
      `${target}.resume`,
      new TextEncoder().encode(JSON.stringify({ url, total: 10, etag: 'v1' })),
    ],
  ]);
  const requests: Record<string, string>[] = [];
  const progress: unknown[] = [];
  const handles = new Map<number, string>();
  let fd = 0;
  const fileIo = {
    OpenMode: { READ_ONLY: 1, WRITE_ONLY: 2, CREATE: 4, APPEND: 8 },
    accessSync: (path: string) => files.has(path),
    stat: async (path: string) => ({ size: files.get(path)?.length || 0 }),
    open: async (path: string, mode: number) => {
      if (mode & 4) files.set(path, new Uint8Array());
      handles.set(++fd, path);
      return { fd };
    },
    close: async () => {},
    read: async (handle: number, buffer: ArrayBuffer) => {
      const bytes = files.get(handles.get(handle) || '') || new Uint8Array();
      new Uint8Array(buffer).set(bytes);
      return bytes.length;
    },
    write: async (handle: number, data: ArrayBuffer | Uint8Array) => {
      const path = handles.get(handle) || '';
      const previous = files.get(path) || new Uint8Array();
      const bytes = new Uint8Array(data);
      const next = new Uint8Array(previous.length + bytes.length);
      next.set(previous);
      next.set(bytes, previous.length);
      files.set(path, next);
      return bytes.length;
    },
    unlink: async (path: string) => {
      files.delete(path);
    },
    mkdir: async () => {},
  };
  const module = runInNewContext(`${javascript}\nDownloadTask`, {
    fileIo,
    NativePatchCore: {
      resumePlanRequest: (...args: unknown[]) => native('plan', args),
      resumeClassifyResponse: (...args: unknown[]) => native('response', args),
      resumeSidecar: (...args: unknown[]) => native('sidecar', args),
    },
    http: {
      RequestMethod: { GET: 'GET' },
      createHttp: () => {
        const events: Record<string, (...args: unknown[]) => void> = {};
        return {
          on: (name: string, fn: (...args: unknown[]) => void) => {
            events[name] = fn;
          },
          off: (name: string) => {
            delete events[name];
          },
          destroy: () => {},
          requestInStream: async (
            _url: string,
            options: { header: Record<string, string> }
          ) => {
            requests.push(options.header);
            const reply = replies.shift();
            if (!reply) throw new Error('unexpected request');
            events.headersReceive({
              'content-length': String(reply.length ?? reply.body.length),
              'content-range': reply.range || '',
              'content-encoding': reply.encoding || '',
              etag: 'v1',
            });
            events.dataReceive(new TextEncoder().encode(reply.body).buffer);
            events.dataEnd();
            return reply.status;
          },
        };
      },
    },
    util: {
      TextEncoder: class {
        encodeInto(text: string) {
          return new TextEncoder().encode(text);
        }
      },
      TextDecoder: class {
        decodeToString(bytes: Uint8Array) {
          return new TextDecoder().decode(bytes);
        }
      },
    },
    EventHub: {
      getInstance: () => ({
        emit: (...args: unknown[]) => progress.push(args),
      }),
    },
    monotonicNowMs: () => 100,
    logger: { error: () => {} },
    MAX_ARCHIVE_BYTES: 1024,
    UNKNOWN_LENGTH_FREE_SPACE_PROBE_BYTES: 64,
    ensureFreeSpace: async () => {},
    ERROR_DOWNLOAD_FAILED: 'DOWNLOAD_FAILED',
    ERROR_PATCH_FAILED: 'PATCH_FAILED',
    createUpdateError: (_code: string, message: string) => new Error(message),
    getErrorMessage: (error: Error) => error.message,
    toUpdateError: (error: Error) => error,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  }) as new (
    context: object
  ) => { downloadFile(params: object): Promise<void> };
  const task = new module({});
  return {
    files,
    requests,
    progress,
    run: () =>
      task.downloadFile({
        url,
        targetFile: target,
        hash: 'a',
        deadlineUptimeMs: 10000,
      }),
    text: () => new TextDecoder().decode(files.get(target)),
  };
}

describe('Harmony downloader with real C++ resume decisions and simulated IO', () => {
  test('206 appends at actual partial offset', async () => {
    const h = load([{ status: 206, body: 'defghij', range: 'bytes 3-9/10' }]);
    await h.run();
    expect(h.text()).toBe('abcdefghij');
    expect(h.requests[0].Range).toBe('bytes=3-');
    expect(h.requests[0]['If-Range']).toBe('v1');
    expect(h.requests[0]['Accept-Encoding']).toBe('identity');
  });
  for (const reply of [
    { status: 416, body: 'error' },
    { status: 206, body: 'bad', range: 'bytes 3x-9/10' },
    { status: 206, body: 'bad', range: 'bytes 0-9/10' },
    { status: 206, body: 'bad', range: 'bytes 3-9/10', encoding: 'gzip' },
  ]) {
    test(`restarts once without appending rejected body: ${JSON.stringify(reply)}`, async () => {
      const h = load([reply, { status: 200, body: '0123456789' }]);
      await h.run();
      expect(h.text()).toBe('0123456789');
      expect(h.requests).toHaveLength(2);
      expect(h.requests[1].Range).toBeUndefined();
    });
  }
  test('second 416 fails instead of looping', async () => {
    const h = load([
      { status: 416, body: 'bad' },
      { status: 416, body: 'bad' },
    ]);
    await expect(h.run()).rejects.toThrow('rejected the download range');
    expect(h.requests).toHaveLength(2);
  });
  test('interrupted transfer preserves partial and resumes next attempt', async () => {
    const replies = [
      { status: 206, body: 'de', length: 7, range: 'bytes 3-9/10' },
    ];
    const h = load(replies);
    await expect(h.run()).rejects.toThrow('Download incomplete');
    expect(h.text()).toBe('abcde');
    expect(h.files.has(`${target}.resume`)).toBe(true);
    replies.push({
      status: 206,
      body: 'fghij',
      length: 5,
      range: 'bytes 5-9/10',
    });
    await h.run();
    expect(h.text()).toBe('abcdefghij');
    expect(h.requests[1].Range).toBe('bytes=5-');
  });
  test('complete archive skips network', async () => {
    const h = load([], 'abcdefghij');
    await h.run();
    expect(h.requests).toHaveLength(0);
  });
  test('HTTP error body cannot poison partial', async () => {
    const h = load([{ status: 503, body: 'error' }]);
    await expect(h.run()).rejects.toThrow('503');
    expect(h.text()).toBe('abc');
  });
});
