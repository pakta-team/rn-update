/**
 * [INPUT]: 依赖运行时代理、共享流式上传传输、独立服务 multipart 会话协议、CLI 凭据与本地化文案
 * [OUTPUT]: 对外提供认证请求、当前应用会员权益读取、按字节显示进度的对象上传、应用渠道（含创建）、原生包、不可变热更新包/投放策略与 Hermes base 查询 API
 * [POS]: CLI 传输边界，统一上传期限、重试流重建与进度回滚；standalone 保留对象定位、ETag 和 complete/abort 会话终局，不回退旧 /app 路由
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import filesizeParser from 'filesize-parser';
import fs from 'fs';
import path from 'path';
import type ProgressBar from 'progress';
import { Readable } from 'stream';
import packageJson from '../package.json';
import type { Package, Session } from './types';
import { credentialFileForService, pricingPageUrl } from './utils/constants';
import type { HermesBaseServerRecord } from './utils/hermes-base';
import { getBaseUrl, isStandaloneService } from './utils/http-helper';
import { t } from './utils/i18n';
import {
  measureTcpLatency,
  proxyAgentFor,
  type RuntimeRequestInit,
  type RuntimeResponse,
  resolveProxy,
  runtimeFetch,
} from './utils/runtime';
import {
  multipartRequest,
  sendUploadRequest,
  type UploadRequest,
  type UploadResponse,
} from './utils/upload-request';

let session: Session | undefined;
let savedSession: Session | undefined;
let apiToken: string | undefined;

function credentialPath(): string {
  return credentialFileForService(process.env.RNU_SERVICE_URL);
}

/** Unwrap the standalone service's `{ data: ... }` envelope. */
export function unwrapData<T = any>(response: any): T {
  if (response && typeof response === 'object' && 'data' in response) {
    return response.data as T;
  }
  return response as T;
}

/** Prefix management routes only when talking to the independent Go service. */
export function servicePath(route: string): string {
  if (!route.startsWith('/')) {
    route = `/${route}`;
  }
  if (!isStandaloneService()) return route;
  const configured = process.env.RNU_SERVICE_URL?.trim().replace(/\/+$/, '');
  return configured?.endsWith('/admin/api/v1')
    ? route
    : `/admin/api/v1${route}`;
}

const userAgent = `rn-update-cli/${packageJson.version}`;

export const getSession = () => session;

export const getApiToken = () => apiToken;

export const setApiToken = (token: string) => {
  apiToken = token;
};

const loadApiTokenFromEnv = () => {
  const envToken = process.env.PAKTA_API_TOKEN;
  if (envToken) {
    apiToken = envToken;
  }
};

export const replaceSession = (newSession: { token: string }) => {
  session = newSession;
};

export const loadSession = async () => {
  loadApiTokenFromEnv();
  const file = credentialPath();
  if (fs.existsSync(file)) {
    try {
      replaceSession(JSON.parse(fs.readFileSync(file, 'utf8')));
      savedSession = session;
    } catch (e) {
      console.error(`Failed to parse file ${file}. Try to remove it manually.`);
      throw e;
    }
  }
};

export const saveSession = () => {
  // Only save on change.
  if (session !== savedSession) {
    const current = session;
    const data = JSON.stringify(current, null, 4);
    const file = credentialPath();
    fs.writeFileSync(file, data, { encoding: 'utf8', mode: 0o600 });
    try {
      // mode above only applies on creation; tighten pre-existing files too
      fs.chmodSync(file, 0o600);
    } catch {
      // best-effort (e.g. exotic filesystems); the token is still saved
    }
    savedSession = current;
  }
};

export const closeSession = () => {
  const file = credentialPath();
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
    savedSession = undefined;
  }
  session = undefined;
};

/** Remove credentials, query signatures and fragments before logging a URL. */
export function redactRequestUrl(requestUrl: string): string {
  try {
    const parsed = new URL(requestUrl);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}${
      parsed.search ? '?<redacted>' : ''
    }`;
  } catch {
    const secretStart = requestUrl.search(/[?#]/);
    return secretStart < 0
      ? requestUrl
      : `${requestUrl.slice(0, secretStart)}?<redacted>`;
  }
}

function createRequestError(
  error: unknown,
  requestUrl: string,
  status?: number,
) {
  const message =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : String(error);
  const cause =
    error instanceof Error || (typeof error === 'object' && error !== null)
      ? error
      : undefined;
  const requestError = new Error(
    `${message}\nURL: ${redactRequestUrl(requestUrl)}`,
    cause === undefined ? undefined : { cause },
  ) as Error & {
    status?: number;
  };
  requestError.status = status;
  return requestError;
}

const PROXY_ERROR_PATTERNS = [
  'socket disconnected before secure TLS connection',
  'ECONNRESET',
  'ECONNREFUSED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_HAS_EXPIRED',
  'self signed certificate',
  'proxy',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
];

function isProxyRelatedError(error: unknown): boolean {
  const seen = new Set<unknown>();
  const parts: string[] = [];
  let current = error;
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) {
      const code = (current as NodeJS.ErrnoException).code;
      parts.push(`${current.name} ${code ?? ''} ${current.message}`);
    } else {
      parts.push(String(current));
    }
    current =
      typeof current === 'object'
        ? (current as { cause?: unknown }).cause
        : undefined;
  }
  const lower = parts.join('\n').toLowerCase();
  return PROXY_ERROR_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}

async function query(url: string, options: RuntimeRequestInit) {
  const baseUrl = await getBaseUrl();
  const fullUrl = `${baseUrl}${url}`;
  let resp: RuntimeResponse;
  try {
    resp = await runtimeFetch(fullUrl, options);
  } catch (error) {
    const baseError = createRequestError(error, fullUrl);
    if (isProxyRelatedError(error)) {
      throw new Error(
        `${baseError.message}\n\n${t('proxyNetworkError')}\n${t('proxyNetworkErrorTips')}`,
        { cause: baseError },
      );
    }
    throw baseError;
  }
  const text = await resp.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch (_e) {
    if (resp.status >= 200 && resp.status < 300) {
      // a proxy/gateway likely replaced the response; surface it instead of
      // returning undefined and crashing callers on destructuring
      throw createRequestError(
        `API returned 200 with non-JSON body (${text.length} bytes)`,
        fullUrl,
        resp.status,
      );
    }
  }

  if (resp.status < 200 || resp.status >= 300) {
    const message =
      json?.message ||
      json?.error?.message ||
      resp.statusText ||
      `HTTP ${resp.status}`;
    if (resp.status === 401) {
      // 迁移后旧 JWT/PAT 会统一返回 401；浏览器之外的 CLI 也要立即清理旧会话文件。
      if (session?.token) {
        closeSession();
      }
      throw createRequestError(t('loginExpired'), fullUrl, resp.status);
    }
    throw createRequestError(message, fullUrl, resp.status);
  }
  return resp.status === 204 ? undefined : json;
}

function queryWithoutBody(method: string) {
  return (api: string) => {
    const headers: Record<string, string> = {
      'User-Agent': userAgent,
    };
    if (apiToken) {
      headers['x-api-token'] = apiToken;
    } else if (session?.token) {
      headers['X-AccessToken'] = session.token;
    }
    return query(api, {
      method,
      headers,
    });
  };
}

function queryWithBody(method: string) {
  return (api: string, body?: Record<string, any>) => {
    const headers: Record<string, string> = {
      'User-Agent': userAgent,
      'Content-Type': 'application/json',
    };
    if (apiToken) {
      headers['x-api-token'] = apiToken;
    } else if (session?.token) {
      headers['X-AccessToken'] = session.token;
    }
    return query(api, {
      method,
      headers,
      body: JSON.stringify(body),
    });
  };
}

export const get = queryWithoutBody('GET');
export const post = queryWithBody('POST');
export const put = queryWithBody('PUT');
export const doDelete = queryWithBody('DELETE');

export async function getMembershipEntitlement(appId: string) {
  return unwrapData<{
    code: string;
    name: string;
    nativePackageMaxBytes: number;
    hotUpdatePackageMaxBytes: number;
  }>(
    await get(
      servicePath(`/membership/entitlement/${encodeURIComponent(appId)}`),
    ),
  );
}

// Upload deadline: generous for a slow link (5 s/MB, i.e. ~200 KB/s, on top
// of a 30 s base, never below 60 s) but bounded, so a stalled connection cannot
// hang a CI job forever. The bar keeps ticking while bytes flow; the deadline
// is absolute.
const UPLOAD_TIMEOUT_BASE_MS = 30_000;
const UPLOAD_TIMEOUT_PER_MB_MS = 5_000;
const UPLOAD_TIMEOUT_MIN_MS = 60_000;
const UPLOAD_MAX_RETRIES = 1;

export function uploadTimeoutMs(fileSize: number): number {
  const megabytes = Math.ceil(Math.max(0, fileSize) / 1048576);
  return Math.max(
    UPLOAD_TIMEOUT_MIN_MS,
    UPLOAD_TIMEOUT_BASE_MS + megabytes * UPLOAD_TIMEOUT_PER_MB_MS,
  );
}

const TRANSIENT_UPLOAD_ERROR_CODES = ['ECONNRESET', 'ETIMEDOUT', 'EPIPE'];

/**
 * A network-level failure worth one more attempt: a reset/timed-out/broken
 * pipe connection, or our own deadline abort. HTTP responses (4xx/5xx) never
 * get here — they are surfaced as-is.
 */
export function isTransientUploadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const { name, code, type, message } = error as {
    name?: string;
    code?: string;
    type?: string;
    message?: string;
  };
  if (name === 'AbortError' || type === 'aborted' || code === 'ABORT_ERR') {
    return true;
  }
  const text = `${code ?? ''} ${message ?? ''}`;
  return TRANSIENT_UPLOAD_ERROR_CODES.some((c) => text.includes(c));
}

class UploadTimeoutError extends Error {
  readonly code = 'ETIMEDOUT';

  constructor(timeoutMs: number) {
    super(`Upload timed out after ${Math.round(timeoutMs / 1000)}s`);
    this.name = 'UploadTimeoutError';
  }
}

/** A byte range of the file (end exclusive) and its retry budget. */
interface UploadSlice {
  start: number;
  end: number;
  retries: number;
}

/**
 * Send the file (or one slice of it) with a size-scaled deadline and retries
 * on a transient network error. `buildRequest` is invoked per attempt with a
 * fresh file stream (a consumed stream/form cannot be replayed).
 */
async function sendUpload(
  fn: string,
  realUrl: string,
  fileSize: number,
  bar: ProgressBar,
  buildRequest: (fileStream: Readable) => UploadRequest,
  slice: UploadSlice = { start: 0, end: fileSize, retries: UPLOAD_MAX_RETRIES },
): Promise<UploadResponse> {
  const timeoutMs = uploadTimeoutMs(slice.end - slice.start);
  // HTTP(S)_PROXY / NO_PROXY, like every other request of the CLI
  const agent = proxyAgentFor(realUrl);
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const fileStream =
      slice.end === slice.start
        ? Readable.from([])
        : fs.createReadStream(fn, { start: slice.start, end: slice.end - 1 });
    let sent = 0;
    fileStream.on('data', (data) => {
      sent += data.length;
      bar.tick(data.length);
    });
    try {
      return await sendUploadRequest(realUrl, buildRequest(fileStream), {
        agent,
        signal: controller.signal,
        userAgent,
      });
    } catch (rawError) {
      fileStream.destroy();
      const error = timedOut ? new UploadTimeoutError(timeoutMs) : rawError;
      if (attempt < slice.retries && isTransientUploadError(error)) {
        const reason = error instanceof Error ? error.message : String(error);
        console.warn(`\nUpload interrupted (${reason}), retrying...`);
        // take this attempt's bytes back off the bar before the next pass
        bar.curr = Math.max(0, bar.curr - sent);
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timer);
      fileStream.destroy();
    }
  }
}

/** Parts in flight at once; each is its own TCP connection. */
const CHUNK_CONCURRENCY = 4;
/** A part is small, so it can afford more retries than the whole file. */
const CHUNK_MAX_RETRIES = 2;

interface ChunkedInstruction {
  key: string;
  partSize: number;
  parts: Record<string, string>[];
}

/** A part the store answered with an HTTP error: retrying will not help. */
class ChunkRejectedError extends Error {}

/**
 * Post the parts of a chunked upload, CHUNK_CONCURRENCY at a time. The first
 * failure stops scheduling new parts; the ones in flight finish, then it is
 * thrown.
 */
async function sendChunks(
  fn: string,
  realUrl: string,
  fileSize: number,
  bar: ProgressBar,
  chunked: ChunkedInstruction,
  postForm: (
    fields: Record<string, string>,
    byteCount: number,
  ) => (fileStream: Readable) => UploadRequest,
): Promise<void> {
  let next = 0;
  let failure: unknown;
  const worker = async () => {
    while (failure === undefined && next < chunked.parts.length) {
      const index = next++;
      const start = index * chunked.partSize;
      const end = Math.min(fileSize, start + chunked.partSize);
      try {
        const res = await sendUpload(
          fn,
          realUrl,
          fileSize,
          bar,
          postForm(chunked.parts[index], end - start),
          { start, end, retries: CHUNK_MAX_RETRIES },
        );
        if (res.status > 299) {
          throw new ChunkRejectedError(
            `${res.status}: ${res.statusText || 'Upload failed'} (part ${index + 1}/${chunked.parts.length})`,
          );
        }
      } catch (error) {
        failure ??= error;
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(CHUNK_CONCURRENCY, chunked.parts.length) },
      worker,
    ),
  );
  if (failure !== undefined) {
    throw failure;
  }
}

/**
 * 创建与旧 CLI 一致的上传进度条，并把文件流读取量映射为已上传字节。
 */
function createUploadProgressBar(fileSize: number): ProgressBar {
  const progressModule = require('progress') as {
    default?: typeof import('progress');
  };
  const ProgressBarImpl =
    progressModule.default ??
    (progressModule as unknown as typeof import('progress'));
  return new ProgressBarImpl('  Uploading [:bar] :percent :etas', {
    complete: '=',
    incomplete: ' ',
    total: Math.max(fileSize, 1),
  });
}

export async function uploadFile(
  fn: string,
  appId?: string | number,
): Promise<{ hash: string; url?: string; key?: string }> {
  if (isStandaloneService()) {
    return uploadMultipartFile(fn, appId);
  }
  const fileSize = fs.statSync(fn).size;
  // appId 用于服务端路由:绑定了自托管节点(rnu-node)的应用,
  // 上传指令会指向节点或其对象存储。chunked + size 让支持的服务端(GCS)
  // 改发分片并行上传的指令;不认识这两个字段的服务端照旧整文件上传
  const resp = await post('/upload', {
    ext: path.extname(fn),
    ...(appId ? { appId: Number(appId) } : {}),
    chunked: true,
    size: fileSize,
  });
  const { url, backupUrl, formData, maxSize } = resp;
  let realUrl = url;
  if (backupUrl && backupUrl !== url) {
    if (global.USE_ACC_OSS) {
      realUrl = backupUrl;
    } else if (!resolveProxy(url)) {
      // a direct TCP probe says nothing about the path through a proxy (and
      // usually cannot connect at all): the primary url stays in that case
      const latency = await measureTcpLatency(url, {
        attempts: 4,
        timeout: 1000,
      });
      if (!Number.isFinite(latency) || latency > 150) {
        realUrl = backupUrl;
      }
    }
  }

  if (maxSize && fileSize > filesizeParser(maxSize)) {
    const readableFileSize = `${(fileSize / 1048576).toFixed(1)}m`;
    throw new Error(
      t('fileSizeExceeded', {
        fileSize: readableFileSize,
        maxSize,
        pricingPageUrl,
      }),
    );
  }

  // progress/form-data are only needed here; keep them off the startup path
  const bar = createUploadProgressBar(fileSize);

  const rethrowUploadError = (error: unknown): never => {
    const baseError = createRequestError(error, realUrl);
    if (isProxyRelatedError(error)) {
      throw new Error(
        `${baseError.message}\n\n${t('proxyNetworkError')}\n${t('proxyNetworkErrorTips')}`,
        { cause: baseError },
      );
    }
    throw baseError;
  };

  // 自托管节点的 s3 直传:服务端下发预签名 PUT,字节直达用户的对象存储
  if (resp.method === 'PUT') {
    let putRes: UploadResponse;
    try {
      putRes = await sendUpload(fn, realUrl, fileSize, bar, (fileStream) => ({
        method: 'PUT',
        body: fileStream,
        // 预签名 PUT 不接受 chunked 传输,必须显式声明长度
        headers: {
          'content-length': String(fileSize),
          ...(resp.headers || {}),
        },
      }));
    } catch (error) {
      return rethrowUploadError(error);
    }
    if (putRes.status > 299) {
      throw createRequestError(
        `${putRes.status}: ${putRes.statusText || 'Upload failed'}`,
        realUrl,
      );
    }
    return { hash: resp.key };
  }

  const postForm =
    (fields: Record<string, string>, byteCount: number) =>
    (fileStream: Readable): UploadRequest =>
      multipartRequest(fields, {
        name: fn,
        size: byteCount,
        stream: fileStream,
      });

  if (resp.chunked) {
    try {
      await sendChunks(fn, realUrl, fileSize, bar, resp.chunked, postForm);
    } catch (error) {
      if (error instanceof ChunkRejectedError) {
        throw createRequestError(error.message, realUrl);
      }
      return rethrowUploadError(error);
    }
    await post('/upload/complete', {
      key: resp.chunked.key,
      parts: resp.chunked.parts.length,
    });
    return { hash: resp.chunked.key as string };
  }

  let res: UploadResponse;
  try {
    res = await sendUpload(
      fn,
      realUrl,
      fileSize,
      bar,
      postForm(formData, fileSize),
    );
  } catch (error) {
    return rethrowUploadError(error);
  }

  if (res.status > 299) {
    throw createRequestError(
      `${res.status}: ${res.statusText || 'Upload failed'}`,
      realUrl,
    );
  }

  return { hash: formData.key };
}

/**
 * 通过独立服务的四阶段 multipart API 上传文件。预签名 URL 直接接收文件流，
 * 进度条按每个分片实际读取的字节数累加；管理 API 只负责元数据与最终 ETag。
 */
async function uploadMultipartFile(fn: string, appId?: string | number) {
  if (!appId) {
    throw new Error(t('standaloneUploadAppIdRequired'));
  }
  const fileName = path.basename(fn);
  const contentType = fileName.endsWith('.ppk')
    ? 'application/octet-stream'
    : fileName.endsWith('.map')
      ? 'application/json'
      : 'application/octet-stream';
  const kind = /\.(apk|ipa|app|aab|hap)$/i.test(fileName) ? 'native' : 'hot';
  const fileSize = fs.statSync(fn).size;
  const created = unwrapData<{ uploadId: string; key: string }>(
    await post(servicePath('/uploads/multipart'), {
      appId: String(appId),
      fileName,
      contentType,
      kind,
      declaredSize: fileSize,
    }),
  );
  const partSize = 8 * 1024 * 1024;
  const partCount = Math.max(1, Math.ceil(fileSize / partSize));
  const partNumbers = Array.from(
    { length: partCount },
    (_, index) => index + 1,
  );
  let presigned: { parts: Array<{ partNumber: number; url: string }> };
  try {
    presigned = unwrapData<{
      parts: Array<{ partNumber: number; url: string }>;
    }>(
      await post(servicePath('/uploads/multipart/parts'), {
        key: created.key,
        uploadId: created.uploadId,
        partNumbers,
      }),
    );
  } catch (error) {
    // 会话创建成功后，预签名请求也可能在网络层失败；此时立即回收会话。
    await post(servicePath('/uploads/multipart/abort'), {
      key: created.key,
      uploadId: created.uploadId,
    }).catch(() => undefined);
    throw error;
  }
  const bar = createUploadProgressBar(fileSize);
  const completed: Array<{ partNumber: number; eTag: string; size: number }> =
    [];
  try {
    for (const part of presigned.parts) {
      const start = (part.partNumber - 1) * partSize;
      const length = Math.min(partSize, Math.max(0, fileSize - start));
      const response = await sendUpload(
        fn,
        part.url,
        fileSize,
        bar,
        (partStream) => ({
          method: 'PUT',
          body: partStream,
          headers: { 'content-length': String(length) },
        }),
        { start, end: start + length, retries: UPLOAD_MAX_RETRIES },
      );
      if (response.status < 200 || response.status > 299) {
        throw new Error(
          t('objectStorageUploadFailed', { status: response.status }),
        );
      }
      const eTag = response.eTag;
      if (!eTag) {
        throw new Error(
          t('objectStoragePartETagMissing', { partNumber: part.partNumber }),
        );
      }
      completed.push({ partNumber: part.partNumber, eTag, size: length });
    }
  } catch (error) {
    await post(servicePath('/uploads/multipart/abort'), {
      key: created.key,
      uploadId: created.uploadId,
    }).catch(() => undefined);
    throw error;
  }
  let result: { key: string; url: string };
  try {
    result = unwrapData<{ key: string; url: string }>(
      await post(servicePath('/uploads/multipart/complete'), {
        key: created.key,
        uploadId: created.uploadId,
        parts: completed,
      }),
    );
  } catch (error) {
    // 完成请求本身也可能在网络层失败；清理会话和对象，避免留下悬挂 multipart。
    await post(servicePath('/uploads/multipart/abort'), {
      key: created.key,
      uploadId: created.uploadId,
    }).catch(() => undefined);
    throw error;
  }
  return { hash: result.key, url: result.url, key: result.key };
}

/**
 * Ask the active service for a Hermes base. The legacy service may resolve an
 * HBC epoch directly; the standalone service returns its newest native package
 * and leaves the downloaded bundle's HBC verification to hermes-base.ts.
 */
export async function getHermesBase(
  appId: string,
  bytecodeVersion: number,
): Promise<HermesBaseServerRecord | null> {
  try {
    const data = await get(
      isStandaloneService()
        ? servicePath(
            `/apps/${encodeURIComponent(appId)}/hermes-base?bytecodeVersion=${bytecodeVersion}`,
          )
        : `/app/${appId}/hermesBase?bytecodeVersion=${bytecodeVersion}`,
    );
    const record =
      data && typeof data === 'object' && 'data' in data ? data.data : data;
    if (!record || typeof record !== 'object' || !record.url || !record.hash) {
      return null;
    }
    return record as HermesBaseServerRecord;
  } catch (error) {
    if ((error as { status?: number })?.status === 404) {
      return null;
    }
    throw error;
  }
}

export const getAllPackages = async (appId: string) => {
  if (isStandaloneService()) {
    const packages: Package[] = [];
    let pageNumber = 1;
    let total = Number.POSITIVE_INFINITY;
    while (packages.length < total) {
      const response = await get(
        servicePath(
          `/apps/${encodeURIComponent(appId)}/versions?page=${pageNumber}&pageSize=100`,
        ),
      );
      const page = unwrapData<{ items?: Package[]; total?: number }>(response);
      const items = page?.items ?? [];
      total =
        typeof page?.total === 'number'
          ? page.total
          : packages.length + items.length;
      packages.push(
        ...items.map(
          (
            item: Package & {
              packageVersion?: string;
              bundleHash?: string;
              hash?: string;
            },
          ) => ({
            ...item,
            name: item.name ?? item.packageVersion ?? '',
            versionName: item.versionName ?? item.packageVersion,
            hash: item.hash ?? item.bundleHash,
          }),
        ),
      );
      if (items.length === 0) break;
      pageNumber += 1;
    }
    return packages;
  }
  // the server caps limit at 100, so page through with offset
  const limit = 100;
  let offset = 0;
  let allPackages: Package[] | undefined | null;
  while (true) {
    const { data, count } = await get(
      `/app/${appId}/package/list?offset=${offset}&limit=${limit}`,
    );
    const packages = data as Package[] | undefined | null;
    if (allPackages === undefined || allPackages === null) {
      allPackages = packages;
    } else if (packages) {
      allPackages.push(...packages);
    }
    if (!packages || packages.length === 0) {
      break;
    }
    offset += packages.length;
    if (offset >= Number(count || 0)) {
      break;
    }
  }
  return allPackages;
};

export interface ServiceChannel {
  id: string;
  code: string;
  name: string;
  paused?: boolean;
}

/** Resolve the registered channel code to the UUID required by the Go API. */
export async function getChannels(appId: string): Promise<ServiceChannel[]> {
  if (!isStandaloneService()) {
    return [];
  }
  const pageSize = 100;
  const channels: ServiceChannel[] = [];
  for (let pageNumber = 1; ; pageNumber += 1) {
    const response = await get(
      servicePath(
        `/apps/${encodeURIComponent(appId)}/channels?page=${pageNumber}&pageSize=${pageSize}`,
      ),
    );
    const page = unwrapData<{ items?: ServiceChannel[]; total?: number }>(
      response,
    );
    const items = page?.items ?? [];
    channels.push(...items);
    if (
      items.length === 0 ||
      (page?.total !== undefined && channels.length >= page.total) ||
      items.length < pageSize
    ) {
      break;
    }
  }
  return channels;
}

/** Create one standalone-service channel with an explicit code/name identity. */
export async function createChannel(
  appId: string,
  code: string,
  name = code,
): Promise<ServiceChannel> {
  if (!isStandaloneService()) {
    throw new Error(t('channelManagementStandaloneOnly'));
  }
  const response = await post(
    servicePath(`/apps/${encodeURIComponent(appId)}/channels`),
    {
      code,
      name,
      nativePackageUrl: '',
      paused: false,
    },
  );
  return unwrapData<ServiceChannel>(response);
}
