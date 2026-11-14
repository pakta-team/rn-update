/**
 * [INPUT]: 依赖 standalone multipart 管理 API、共享有界 PUT 传输与本地文件流
 * [OUTPUT]: 验证 standalone 上传使用流式请求体，并按真实读取字节推进进度条
 * [POS]: API 传输边界的回归测试，锁定旧 CLI 上传体验在独立服务路径上的兼容性
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as transport from '../src/utils/upload-request';

type ProgressRecord = {
  total: number;
  increments: number[];
};

type FetchOptions = {
  body?: unknown;
};

const progressRecords: ProgressRecord[] = [];
const managementRequests: Array<{
  url: string;
  body?: Record<string, unknown>;
}> = [];
let uploadedBody = Buffer.alloc(0);
let uploadedWithStream = false;

class TestProgressBar {
  curr = 0;
  private readonly record: ProgressRecord;

  constructor(_format: string, options: { total: number }) {
    this.record = { total: options.total, increments: [] };
    progressRecords.push(this.record);
  }

  tick(amount = 1) {
    this.curr += amount;
    this.record.increments.push(amount);
  }
}

const runtimeFetchMock = mock(
  async (url: string, options: FetchOptions = {}) => {
    const body = options.body ? JSON.parse(String(options.body)) : undefined;
    managementRequests.push({ url, body });

    let responseBody: Record<string, unknown>;
    if (url.endsWith('/uploads/multipart')) {
      responseBody = {
        data: { uploadId: 'upload-1', key: 'object-key' },
      };
    } else if (url.endsWith('/uploads/multipart/parts')) {
      responseBody = {
        data: {
          parts: [{ partNumber: 1, url: 'https://storage.test/object-part-1' }],
        },
      };
    } else if (url.endsWith('/uploads/multipart/complete')) {
      responseBody = {
        data: {
          key: 'object-key',
          url: 'https://storage.test/object-key',
        },
      };
    } else {
      throw new Error(`Unexpected management URL: ${url}`);
    }

    return {
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify(responseBody),
    };
  },
);

const uploadMock = mock(async (_url: string, options: FetchOptions = {}) => {
  const body = options.body;
  if (!body || typeof (body as { on?: unknown }).on !== 'function') {
    throw new Error('standalone multipart upload must use a stream body');
  }
  uploadedWithStream = true;

  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    const stream = body as NodeJS.ReadableStream;
    stream.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.once('end', resolve);
    stream.once('error', reject);
  });
  uploadedBody = Buffer.concat(chunks);

  return {
    status: 200,
    statusText: 'OK',
    eTag: 'etag-1',
  };
});

// Mock before importing api.ts: its upload dependencies are loaded lazily.
mock.module('progress', () => ({ default: TestProgressBar }));
mock.module('../src/utils/http-helper', () => ({
  getBaseUrl: async () => 'http://standalone.test',
  isStandaloneService: () => true,
}));
mock.module('../src/utils/runtime', () => ({
  measureTcpLatency: async () => 0,
  proxyAgentFor: () => undefined,
  resolveProxy: () => undefined,
  runtimeFetch: runtimeFetchMock,
}));

const { uploadFile } = await import('../src/api');

describe('standalone multipart upload progress', () => {
  let temporaryFile: string | undefined;

  afterEach(() => {
    if (temporaryFile) {
      fs.rmSync(temporaryFile, { force: true });
      temporaryFile = undefined;
    }
    progressRecords.length = 0;
    managementRequests.length = 0;
    uploadedBody = Buffer.alloc(0);
    uploadedWithStream = false;
  });

  test('streams each part and advances one aggregate progress bar by bytes read', async () => {
    const upload = spyOn(transport, 'sendUploadRequest').mockImplementation(
      uploadMock,
    );
    const expectedBody = Buffer.alloc(256 * 1024, 0x5a);
    temporaryFile = path.join(
      os.tmpdir(),
      `rn-update-cli-upload-progress-${process.pid}.ppk`,
    );
    fs.writeFileSync(temporaryFile, expectedBody);

    let result: Awaited<ReturnType<typeof uploadFile>>;
    try {
      result = await uploadFile(temporaryFile, 'app-1');
    } finally {
      upload.mockRestore();
    }

    expect(result).toEqual({
      hash: 'object-key',
      key: 'object-key',
      url: 'https://storage.test/object-key',
    });
    expect(uploadedWithStream).toBe(true);
    expect(uploadedBody).toEqual(expectedBody);
    expect(progressRecords).toHaveLength(1);
    expect(progressRecords[0].total).toBe(expectedBody.length);
    expect(
      progressRecords[0].increments.reduce(
        (total, amount) => total + amount,
        0,
      ),
    ).toBe(expectedBody.length);
    expect(managementRequests.map(({ url }) => url)).toEqual([
      'http://standalone.test/admin/api/v1/uploads/multipart',
      'http://standalone.test/admin/api/v1/uploads/multipart/parts',
      'http://standalone.test/admin/api/v1/uploads/multipart/complete',
    ]);
  });
});
