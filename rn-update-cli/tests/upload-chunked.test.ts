import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

type FetchCall = { url: string; body: Buffer };
const fetchCalls: FetchCall[] = [];
let fetchImpl: (call: FetchCall) => Promise<{ status: number }> = async () => ({
  status: 204,
});

// Read the streamed multipart body the way the socket would.
async function drain(body: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

const uploadRequest = await import('../src/utils/upload-request');
const { uploadFile } = await import('../src/api');
const runtime = await import('../src/utils/runtime');
const httpHelper = await import('../src/utils/http-helper');

const tmp = path.join(os.tmpdir(), `rnu-chunked-${process.pid}.ppk`);
// distinct bytes per MiB, so a misplaced range is visible
const content = Buffer.concat(
  Array.from({ length: 5 }, (_, index) => Buffer.alloc(1 << 20, 65 + index)),
).subarray(0, (5 << 20) - 123);

describe('chunked upload', () => {
  let spies: { mockRestore: () => void }[] = [];
  const env = { ...process.env };

  afterEach(() => {
    for (const spy of spies) spy.mockRestore();
    spies = [];
    fetchCalls.length = 0;
    fetchImpl = async () => ({ status: 204 });
    process.env = { ...env };
    fs.rmSync(tmp, { force: true });
  });

  function setup(instruction: Record<string, unknown>) {
    fs.writeFileSync(tmp, content);
    for (const name of [
      'HTTPS_PROXY',
      'https_proxy',
      'HTTP_PROXY',
      'http_proxy',
    ]) {
      delete process.env[name];
    }
    const apiCalls: { url: string; body: any }[] = [];
    spies.push(
      spyOn(runtime, 'runtimeFetch').mockImplementation(
        async (url: string, init?: any) => {
          apiCalls.push({
            url,
            body: init?.body ? JSON.parse(init.body) : undefined,
          });
          const payload = url.endsWith('/upload/complete')
            ? { key: 'k' }
            : instruction;
          return {
            status: 200,
            statusText: 'OK',
            text: async () => JSON.stringify(payload),
          };
        },
      ),
      spyOn(uploadRequest, 'sendUploadRequest').mockImplementation(
        async (url, request) => {
          const call = { url, body: await drain(request.body) };
          expect(Number(request.headers['content-length'])).toBe(
            call.body.length,
          );
          fetchCalls.push(call);
          return { statusText: '', ...(await fetchImpl(call)) };
        },
      ),
      spyOn(runtime, 'measureTcpLatency').mockResolvedValue(10),
      // the base url is memoized per process: another test file may have
      // resolved it already, so pin it instead of setting RNU_API
      spyOn(httpHelper, 'getBaseUrl').mockResolvedValue('https://api.test'),
      spyOn(console, 'warn').mockImplementation(() => {}),
    );
    return apiCalls;
  }

  const gcs = 'https://storage.googleapis.com/cresc-storage';
  const partSize = 2 << 20;
  const chunkedInstruction = {
    url: gcs,
    backupUrl: gcs,
    formData: { key: 'k' },
    chunked: {
      key: 'k',
      partSize,
      parts: [1, 2, 3].map((n) => ({ key: `k.part${n}`, policy: `p${n}` })),
    },
  };

  test('announces the size, posts every byte range once, then completes', async () => {
    const apiCalls = setup(chunkedInstruction);
    const result = await uploadFile(tmp, 9);

    expect(apiCalls[0].url).toBe('https://api.test/upload');
    expect(apiCalls[0].body).toEqual({
      ext: '.ppk',
      appId: 9,
      chunked: true,
      size: content.length,
    });
    expect(fetchCalls).toHaveLength(3);
    for (const [index, name] of ['k.part1', 'k.part2', 'k.part3'].entries()) {
      const call = fetchCalls.find((c) =>
        c.body.includes(`\r\n\r\n${name}\r\n`),
      );
      expect(call).toBeDefined();
      const slice = content.subarray(index * partSize, (index + 1) * partSize);
      expect(call!.url).toBe(gcs);
      expect(call!.body.includes(slice)).toBe(true);
      expect(call!.body.length).toBeLessThan(slice.length + 2048);
    }
    expect(apiCalls[1]).toEqual({
      url: 'https://api.test/upload/complete',
      body: { key: 'k', parts: 3 },
    });
    expect(result).toEqual({ hash: 'k' });
  });

  test('retries a part after a reset and still completes', async () => {
    const apiCalls = setup(chunkedInstruction);
    let failed = false;
    fetchImpl = async (call) => {
      if (!failed && call.body.includes('\r\n\r\nk.part2\r\n')) {
        failed = true;
        throw Object.assign(new Error('socket hang up'), {
          code: 'ECONNRESET',
        });
      }
      return { status: 204 };
    };
    await uploadFile(tmp);
    expect(fetchCalls).toHaveLength(4);
    expect(apiCalls.at(-1)?.url).toBe('https://api.test/upload/complete');
  });

  test('a rejected part fails the upload without completing it', async () => {
    const apiCalls = setup(chunkedInstruction);
    fetchImpl = async (call) => ({
      status: call.body.includes('\r\n\r\nk.part1\r\n') ? 403 : 204,
    });
    await expect(uploadFile(tmp)).rejects.toThrow('403');
    expect(apiCalls.some((c) => c.url.endsWith('/upload/complete'))).toBe(
      false,
    );
  });

  test('a server without chunking gets the single POST and no probe', async () => {
    const apiCalls = setup({
      url: gcs,
      backupUrl: gcs,
      formData: { key: 'k' },
    });
    const result = await uploadFile(tmp);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].body.includes(content)).toBe(true);
    expect(runtime.measureTcpLatency).not.toHaveBeenCalled();
    expect(apiCalls).toHaveLength(1);
    expect(result).toEqual({ hash: 'k' });
  });
});
