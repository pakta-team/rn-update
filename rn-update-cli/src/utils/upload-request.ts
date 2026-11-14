/**
 * [INPUT]: 依赖 node:http/https、Readable 流与文件扩展名 MIME 约定
 * [OUTPUT]: 对外提供 multipartRequest、sendUploadRequest、携带可选原始 ETag 的 UploadResponse、UploadRequest 与 fileContentType
 * [POS]: CLI 单次上传传输层，以精确 Content-Length 和调用方代理直传对象存储；取消、失败或响应到达时停止请求体并清理取消监听
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

// Streaming uploads on node:http(s): a multipart form or a raw PUT whose body
// is read from disk as it is sent, with an exact Content-Length.

import { randomBytes } from 'crypto';
import type { Agent as HttpAgent } from 'http';
import path from 'path';
import { Readable } from 'stream';

export interface UploadRequest {
  method: string;
  headers: Record<string, string>;
  body: Readable;
}

export interface UploadResponse {
  status: number;
  statusText: string;
  eTag?: string;
}

/**
 * The file part's Content-Type for the extensions the CLI uploads, as the
 * form-data package used to pick them (mime-types): object stores keep it as
 * the stored object's type.
 */
const FILE_CONTENT_TYPES: Record<string, string> = {
  '.aab': 'application/x-authorware-bin',
  '.apk': 'application/vnd.android.package-archive',
  '.json': 'application/json',
  '.map': 'application/json',
  '.zip': 'application/zip',
};

export function fileContentType(fileName: string): string {
  return (
    FILE_CONTENT_TYPES[path.extname(fileName).toLowerCase()] ??
    'application/octet-stream'
  );
}

/**
 * multipart/form-data with `fields` first and the file last. The file's size
 * is known up front, so the request carries Content-Length instead of a
 * chunked body: what object stores expect, and the only framing that survives
 * a proxy agent's rewrite of the buffered request head.
 */
export function multipartRequest(
  fields: Record<string, string>,
  file: { name: string; size: number; stream: Readable },
): UploadRequest {
  // A 'data' listener (the progress bar) may have set the stream flowing:
  // hold its chunks until the body below reads them.
  file.stream.pause();
  const boundary = `--------------------------${randomBytes(12).toString('hex')}`;
  let head = '';
  for (const [name, value] of Object.entries(fields)) {
    head += `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  }
  head +=
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${path.basename(file.name)}"\r\n` +
    `Content-Type: ${fileContentType(file.name)}\r\n\r\n`;
  const headBytes = Buffer.from(head);
  const tailBytes = Buffer.from(`\r\n--${boundary}--\r\n`);
  async function* parts() {
    yield headBytes;
    let sent = 0;
    for await (const chunk of file.stream) {
      sent += (chunk as Buffer).length;
      yield chunk as Buffer;
    }
    // a file that shrank since its size was taken would leave the request
    // short of its Content-Length, waiting out the whole upload deadline
    if (sent !== file.size) {
      throw new Error(
        `${file.name} changed during the upload: sent ${sent} of ${file.size} bytes`,
      );
    }
    yield tailBytes;
  }
  return {
    method: 'POST',
    headers: {
      'content-type': `multipart/form-data;boundary=${boundary}`,
      'content-length': String(headBytes.length + file.size + tailBytes.length),
    },
    body: Readable.from(parts(), { objectMode: false }),
  };
}

/**
 * Send `request` and resolve with the response status once its head arrives
 * (the body is drained and dropped). Network errors reject as they are, with
 * their `code` (ECONNRESET, ...); aborting `signal` rejects with an AbortError.
 */
export function sendUploadRequest(
  url: string,
  request: UploadRequest,
  options: { agent?: HttpAgent; signal?: AbortSignal; userAgent?: string },
): Promise<UploadResponse> {
  const { request: send } = url.startsWith('https:')
    ? (require('https') as typeof import('https'))
    : (require('http') as typeof import('http'));
  return new Promise((resolve, reject) => {
    const { signal } = options;
    const abortError = () =>
      Object.assign(new Error('The upload was aborted'), {
        name: 'AbortError',
        code: 'ABORT_ERR',
      });
    if (signal?.aborted) {
      request.body.destroy();
      reject(abortError());
      return;
    }
    let req: import('http').ClientRequest;
    try {
      req = send(url, {
        method: request.method,
        headers: {
          accept: '*/*',
          ...(options.userAgent ? { 'user-agent': options.userAgent } : {}),
          ...request.headers,
        },
        agent: options.agent,
      });
    } catch (error) {
      request.body.destroy();
      reject(error);
      return;
    }
    let settled = false;
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
      request.body.unpipe(req);
      request.body.destroy();
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      req.destroy(error as Error);
      reject(error);
    };
    const onAbort = () => fail(abortError());
    signal?.addEventListener('abort', onAbort, { once: true });
    req.on('error', fail);
    request.body.on('error', fail);
    req.on('response', (res) => {
      res.on('error', () => res.destroy());
      if (settled) {
        res.destroy();
        return;
      }
      settled = true;
      cleanup();
      res.resume();
      if (!req.writableFinished) req.destroy();
      resolve({
        status: res.statusCode ?? 0,
        statusText: res.statusMessage ?? '',
        ...(res.headers.etag ? { eTag: res.headers.etag } : {}),
      });
    });
    request.body.pipe(req);
  });
}
