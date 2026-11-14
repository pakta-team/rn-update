/**
 * [INPUT]: 依赖 HTTP Range/If-Range 响应、ZIP 中央目录、流与 ZIP 条目读取器
 * [OUTPUT]: 对外提供远程 ZIP 定位、范围读取、缓存读取器和协议错误类型
 * [POS]: CLI 远程制品按需读取底座，减少 Hermes base 与 bundle 获取的网络/磁盘开销
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

// Byte-range access to zip archives.
//
// Two halves of the same trick: at publish time `locateZipEntry` records where
// the bundle's compressed bytes sit inside the ppk (so the server can hand
// that location to the next build), and at build time `fetchZipEntryData` /
// `openRemoteZip` read just the bundle of a remote archive through HTTP Range
// requests instead of downloading the whole ppk / apk / ipa. Every helper
// throws on anything unexpected; callers fall back to a full download.
import fs from 'fs';
import { PassThrough, Readable } from 'stream';
import {
  type Entry,
  fromRandomAccessReader,
  RandomAccessReader,
  type ZipFile,
} from 'yauzl';
import { inflateRawSync, constants as zlibConstants } from 'zlib';
import { webFetch } from './runtime';
import { openFirstEntry, readEntry } from './zip-entries';

export const ZIP_STORED = 0;
export const ZIP_DEFLATED = 8;

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const LOCAL_HEADER_SIZE = 30;
/**
 * Exactly what yauzl reads to find the EOCD (22 + 65535 comment + 20 zip64
 * locator), so its first read is a cache hit; small archives fit entirely.
 */
const TAIL_BYTES = 22 + 0xffff + 20;
/** minimum span fetched for header reads, so header + directory share a request */
const CHUNK_BYTES = 64 * 1024;
/** extra bytes past a hinted entry, covering a longer local extra field */
const HINT_SLACK_BYTES = 4 * 1024;
/**
 * compressed bytes fetched to decode the head of a deflated entry: the
 * dynamic Huffman header plus the first literals fit comfortably
 */
const HEAD_PROBE_BYTES = 4 * 1024;

export interface ZipEntryLocation {
  fileName: string;
  /** absolute offset of the compressed data, past the local file header */
  dataOffset: number;
  compressedSize: number;
  uncompressedSize: number;
  /** 0 = stored, 8 = deflate; anything else cannot be inflated here */
  compressionMethod: number;
}

/** Data location of the first entry matching `matches` in a local zip. */
export async function locateZipEntry(
  zipPath: string,
  matches: (name: string) => boolean,
): Promise<ZipEntryLocation | null> {
  const found = await openFirstEntry(zipPath, matches);
  if (!found) return null;
  found.zipFile.close();
  return locationOfEntry(zipPath, found.entry);
}

/**
 * Content and data location of the first matching entry in one pass over the
 * archive (publish needs both: the bundle to hash and cache, its location to
 * report to the server).
 */
export async function readZipEntryWithLocation(
  zipPath: string,
  matches: (name: string) => boolean,
): Promise<{ data: Buffer; location: ZipEntryLocation } | null> {
  const found = await openFirstEntry(zipPath, matches);
  if (!found) return null;
  let data: Buffer;
  try {
    data = await readEntry(found.entry, found.zipFile);
  } finally {
    found.zipFile.close();
  }
  return { data, location: await locationOfEntry(zipPath, found.entry) };
}

/** Where an entry's data starts, from its local file header at `headerOffset`. */
function dataOffsetFromLocalHeader(header: Buffer, headerOffset: number) {
  if (header.readUInt32LE(0) !== LOCAL_HEADER_SIGNATURE) {
    throw new Error('invalid local file header signature');
  }
  // fixed header, then the file name and extra field lengths it declares
  return (
    headerOffset +
    LOCAL_HEADER_SIZE +
    header.readUInt16LE(26) +
    header.readUInt16LE(28)
  );
}

function assertValidLocation({
  dataOffset,
  compressedSize,
}: Pick<ZipEntryLocation, 'dataOffset' | 'compressedSize'>) {
  if (
    !Number.isInteger(dataOffset) ||
    !Number.isInteger(compressedSize) ||
    dataOffset < 0 ||
    compressedSize <= 0
  ) {
    throw new Error('invalid bundle location');
  }
}

async function locationOfEntry(
  zipPath: string,
  entry: Entry,
): Promise<ZipEntryLocation> {
  const header = Buffer.alloc(LOCAL_HEADER_SIZE);
  const handle = await fs.promises.open(zipPath, 'r');
  try {
    const { bytesRead } = await handle.read(
      header,
      0,
      LOCAL_HEADER_SIZE,
      entry.relativeOffsetOfLocalHeader,
    );
    if (bytesRead !== LOCAL_HEADER_SIZE) {
      throw new Error('truncated local file header');
    }
  } finally {
    await handle.close();
  }
  return {
    fileName: entry.fileName,
    dataOffset: dataOffsetFromLocalHeader(
      header,
      entry.relativeOffsetOfLocalHeader,
    ),
    compressedSize: entry.compressedSize,
    uncompressedSize: entry.uncompressedSize,
    compressionMethod: entry.compressionMethod,
  };
}

/**
 * The `bundleOffset` / `bundleCompressedSize` / `bundleCompression` fields for
 * version/create and package/create, or nothing when the entry cannot be
 * fetched by a single Range request (unknown, empty or exotic compression).
 */
export function bundleLocationFields(
  location: ZipEntryLocation | null | undefined,
): Record<string, number> {
  if (
    !location ||
    location.compressedSize <= 0 ||
    (location.compressionMethod !== ZIP_STORED &&
      location.compressionMethod !== ZIP_DEFLATED)
  ) {
    return {};
  }
  return {
    bundleOffset: location.dataOffset,
    bundleCompressedSize: location.compressedSize,
    bundleCompression: location.compressionMethod,
  };
}

// ---------------------------------------------------------------------------
// HTTP Range
// ---------------------------------------------------------------------------

/** Deadlines for the Range requests; every field has a default. */
export interface RangeOptions {
  /** reads of at most CHUNK_BYTES (tail, headers, directory pages), default 20 s */
  headerTimeoutMs?: number;
  /** base deadline for larger reads (entry data, a prefetched directory), default 30 s */
  dataTimeoutMs?: number;
  /** added to `dataTimeoutMs` per MB requested, default 1 s */
  dataTimeoutPerMbMs?: number;
}

const DEFAULT_HEADER_TIMEOUT_MS = 20_000;
const DEFAULT_DATA_TIMEOUT_MS = 30_000;
const DEFAULT_DATA_TIMEOUT_PER_MB_MS = 1_000;

/** deadline for a request of `bytes`: flat for header-sized reads, scaled otherwise */
function timeoutFor(bytes: number, options: RangeOptions): number {
  if (bytes <= CHUNK_BYTES) {
    return options.headerTimeoutMs ?? DEFAULT_HEADER_TIMEOUT_MS;
  }
  // AbortSignal.timeout() rejects a fractional delay
  return Math.ceil(
    (options.dataTimeoutMs ?? DEFAULT_DATA_TIMEOUT_MS) +
      ((options.dataTimeoutPerMbMs ?? DEFAULT_DATA_TIMEOUT_PER_MB_MS) * bytes) /
        (1024 * 1024),
  );
}

/** The server answered a Range request with the whole body (HTTP 200). */
export class RangeUnsupportedError extends Error {
  constructor(readonly response: Response) {
    super(`HTTP ${response.status} without Content-Range`);
    this.name = 'RangeUnsupportedError';
  }
}

interface ContentRange {
  start: number;
  end: number;
  total: number;
}

export function parseContentRange(header: string | null): ContentRange | null {
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+)$/i.exec(header?.trim() ?? '');
  if (!match) return null;
  const [start, end, total] = match.slice(1).map(Number);
  if (end < start || end >= total) return null;
  return { start, end, total };
}

/**
 * The validator to send as `If-Range` on later requests for the same object,
 * so a replaced archive answers 200 (handled like a server without Range)
 * instead of mixing bytes of two versions. Weak ETags are not allowed there.
 */
export function rangeValidator(headers: Headers): string | undefined {
  const etag = headers.get('etag')?.trim();
  if (etag && !/^W\//i.test(etag)) return etag;
  return headers.get('last-modified')?.trim() || undefined;
}

/** An aborted fetch as a plain Error (never mistaken for a 200 answer). */
function describeAbort(error: unknown, what: string, timeoutMs: number): Error {
  const name = (error as { name?: string } | null)?.name;
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new Error(`timed out after ${timeoutMs} ms fetching ${what}`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

interface RequestOptions {
  timeoutMs: number;
  ifRange?: string;
  /** archive size seen by the first request; a different one is an error */
  expectTotal?: number;
}

/** One Range request; `end` is exclusive. Resolves with a 206 response. */
async function fetchRange(
  url: string,
  start: number,
  end: number,
  options: RequestOptions,
): Promise<Response & { range: ContentRange }> {
  const what = `bytes=${start}-${end - 1}`;
  const headers: Record<string, string> = {
    Range: what,
    'Accept-Encoding': 'identity',
  };
  if (options.ifRange) headers['If-Range'] = options.ifRange;
  let response: Response;
  try {
    response = await webFetch(url, {
      headers,
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch (error) {
    throw describeAbort(error, what, options.timeoutMs);
  }
  if (response.status === 200) throw new RangeUnsupportedError(response);
  if (response.status !== 206 || !response.body) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`HTTP ${response.status} for ${what}`);
  }
  const range = parseContentRange(response.headers.get('content-range'));
  if (!range || range.start !== start || range.end !== end - 1) {
    await response.body.cancel().catch(() => {});
    throw new Error(
      `unexpected Content-Range ${response.headers.get('content-range')}`,
    );
  }
  if (
    options.expectTotal !== undefined &&
    range.total !== options.expectTotal
  ) {
    await response.body.cancel().catch(() => {});
    throw new Error(
      `archive size changed: ${range.total} bytes, expected ${options.expectTotal}`,
    );
  }
  return Object.assign(response, { range });
}

async function fetchRangeBuffer(
  url: string,
  start: number,
  end: number,
  options: RequestOptions,
): Promise<{ data: Buffer; total: number }> {
  const response = await fetchRange(url, start, end, options);
  let data: Buffer;
  try {
    // Buffer.from(ArrayBuffer) is a view: the body is held exactly once
    data = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    throw describeAbort(error, `bytes=${start}-${end - 1}`, options.timeoutMs);
  }
  if (data.length !== end - start) {
    throw new Error(
      `range returned ${data.length} bytes, expected ${end - start}`,
    );
  }
  return { data, total: response.range.total };
}

/**
 * Fetch one entry whose compressed bytes are already located (the ppk's own
 * publish-time report) and decompress it. Returns the raw entry content.
 */
export async function fetchZipEntryData(
  url: string,
  location: Pick<
    ZipEntryLocation,
    'dataOffset' | 'compressedSize' | 'compressionMethod'
  >,
  options: RangeOptions = {},
): Promise<{ data: Buffer; fetchedBytes: number; totalBytes: number }> {
  const { dataOffset, compressedSize, compressionMethod } = location;
  if (compressionMethod !== ZIP_STORED && compressionMethod !== ZIP_DEFLATED) {
    throw new Error(`unsupported compression method ${compressionMethod}`);
  }
  assertValidLocation(location);
  const { data, total } = await fetchRangeBuffer(
    url,
    dataOffset,
    dataOffset + compressedSize,
    { timeoutMs: timeoutFor(compressedSize, options) },
  );
  return {
    data: compressionMethod === ZIP_DEFLATED ? inflateRawSync(data) : data,
    fetchedBytes: compressedSize,
    totalBytes: total,
  };
}

/**
 * Up to `bytes` leading bytes of an entry, decoded from a prefix of its
 * compressed data (a truncated deflate stream is inflated as far as it goes).
 */
export function decodeEntryHead(
  raw: Buffer,
  compressionMethod: number,
  bytes: number,
): Buffer {
  if (compressionMethod === ZIP_STORED) return raw.subarray(0, bytes);
  if (compressionMethod !== ZIP_DEFLATED) {
    throw new Error(`unsupported compression method ${compressionMethod}`);
  }
  return inflateRawSync(raw, {
    finishFlush: zlibConstants.Z_SYNC_FLUSH,
  }).subarray(0, bytes);
}

/** compressed bytes needed to decode the first `bytes` of an entry */
function headProbeSize(
  compressedSize: number,
  compressionMethod: number,
  bytes: number,
): number {
  return Math.min(
    compressedSize,
    compressionMethod === ZIP_STORED ? bytes : HEAD_PROBE_BYTES,
  );
}

/**
 * The first `bytes` of an entry whose compressed bytes are already located,
 * from one small Range request (see `fetchZipEntryData`).
 */
export async function fetchZipEntryHead(
  url: string,
  location: Pick<
    ZipEntryLocation,
    'dataOffset' | 'compressedSize' | 'compressionMethod'
  >,
  bytes: number,
  options: RangeOptions = {},
): Promise<Buffer> {
  const { dataOffset, compressedSize, compressionMethod } = location;
  assertValidLocation(location);
  const size = headProbeSize(compressedSize, compressionMethod, bytes);
  const { data } = await fetchRangeBuffer(url, dataOffset, dataOffset + size, {
    timeoutMs: timeoutFor(size, options),
  });
  return decodeEntryHead(data, compressionMethod, bytes);
}

export interface HttpRangeReaderOptions extends RangeOptions {
  /** validator of the archive (see `rangeValidator`), sent as If-Range */
  ifRange?: string;
}

interface Chunk {
  start: number;
  data: Buffer;
}

/**
 * yauzl reader over HTTP Range. Header reads (EOCD, central directory, local
 * file headers) are widened to CHUNK_BYTES and cached. Chunks are kept as
 * fetched — only overlapping ones are merged, touching ones are read across —
 * so an entry's bytes are held once, and a read reuses whatever prefix the
 * cache holds (typically the bytes following the local file header) before
 * requesting the rest. Every request after the first carries If-Range and
 * must report the same archive size.
 */
export class HttpRangeReader extends RandomAccessReader {
  /** sorted by `start`, never overlapping */
  private chunks: Chunk[] = [];
  /** span a header read inside it should widen to (see `hintEntry`) */
  private hint: { start: number; end: number } | null = null;
  requests = 0;
  fetchedBytes = 0;

  constructor(
    private readonly url: string,
    readonly totalSize: number,
    tail?: Chunk,
    private readonly options: HttpRangeReaderOptions = {},
  ) {
    super();
    if (tail) this.addChunk(tail.start, tail.data);
  }

  /**
   * The next entry to be read: yauzl first reads its local file header, and
   * widening that read to the entry's data makes the data stream a cache hit
   * — one request for header + bundle instead of two. The central directory
   * may understate the local header's extra field, hence the slack.
   */
  hintEntry(entry: Entry): void {
    const start = entry.relativeOffsetOfLocalHeader;
    const end =
      start +
      LOCAL_HEADER_SIZE +
      entry.fileNameLength +
      entry.extraFieldLength +
      entry.compressedSize +
      HINT_SLACK_BYTES;
    this.hint = { start, end: Math.min(end, this.totalSize) };
  }

  /** Cache `data` at `start`, merging with any chunk it overlaps. */
  addChunk(start: number, data: Buffer): void {
    if (data.length === 0) return;
    let lo = start;
    let hi = start + data.length;
    const pieces: Chunk[] = [{ start, data }];
    const rest: Chunk[] = [];
    for (const chunk of this.chunks) {
      const chunkEnd = chunk.start + chunk.data.length;
      if (chunk.start < hi && chunkEnd > lo) {
        pieces.push(chunk);
        lo = Math.min(lo, chunk.start);
        hi = Math.max(hi, chunkEnd);
      } else {
        rest.push(chunk);
      }
    }
    if (pieces.length === 1) {
      rest.push(pieces[0]);
    } else {
      const merged = Buffer.alloc(hi - lo);
      // the new data is written last so it wins over stale overlaps
      for (const piece of pieces.reverse()) {
        piece.data.copy(merged, piece.start - lo);
      }
      rest.push({ start: lo, data: merged });
    }
    rest.sort((a, b) => a.start - b.start);
    this.chunks = rest;
  }

  /** Fetch `[start, end)` into the cache in one request. */
  async prefetch(start: number, end: number): Promise<void> {
    this.addChunk(start, await this.fetchBuffer(start, end));
  }

  private requestOptions(bytes: number): RequestOptions {
    return {
      timeoutMs: timeoutFor(bytes, this.options),
      ifRange: this.options.ifRange,
      expectTotal: this.totalSize,
    };
  }

  private async fetchBuffer(start: number, end: number): Promise<Buffer> {
    this.requests++;
    const { data } = await fetchRangeBuffer(
      this.url,
      start,
      end,
      this.requestOptions(end - start),
    );
    this.fetchedBytes += data.length;
    return data;
  }

  /**
   * Contiguous cached pieces starting exactly at `start`, up to `end`: views
   * into one chunk or into a run of touching chunks, possibly ending short.
   */
  private cachedPieces(start: number, end: number): Buffer[] {
    const pieces: Buffer[] = [];
    let at = start;
    for (const chunk of this.chunks) {
      const chunkEnd = chunk.start + chunk.data.length;
      if (chunkEnd <= at) continue;
      if (chunk.start > at) break;
      const stop = Math.min(end, chunkEnd);
      pieces.push(chunk.data.subarray(at - chunk.start, stop - chunk.start));
      at = stop;
      if (at >= end) break;
    }
    return pieces;
  }

  /** start of the cached run (touching chunks) holding byte `end - 1` */
  private cachedSuffixStart(end: number): number | null {
    let i = this.chunks.findIndex(
      (c) => end - 1 >= c.start && end - 1 < c.start + c.data.length,
    );
    if (i < 0) return null;
    while (
      i > 0 &&
      this.chunks[i - 1].start + this.chunks[i - 1].data.length ===
        this.chunks[i].start
    ) {
      i--;
    }
    return this.chunks[i].start;
  }

  /** start of the first cached chunk at or after `position` */
  private nextCachedStart(position: number): number | null {
    const chunk = this.chunks.find((c) => c.start >= position);
    return chunk ? chunk.start : null;
  }

  _readStreamForRange(start: number, end: number): Readable {
    const pieces = this.cachedPieces(start, end);
    const have = pieces.reduce((sum, piece) => sum + piece.length, 0);
    if (have === end - start) return Readable.from(pieces);
    const out = new PassThrough();
    for (const piece of pieces) out.write(piece);
    const from = start + have;
    const options = this.requestOptions(end - from);
    this.requests++;
    fetchRange(this.url, from, end, options)
      .then((response) => {
        this.fetchedBytes += end - from;
        const body = Readable.fromWeb(response.body as any);
        body.on('error', (error) =>
          out.destroy(
            describeAbort(error, `bytes=${from}-${end - 1}`, options.timeoutMs),
          ),
        );
        body.pipe(out);
      })
      .catch((error) => out.destroy(error));
    return out;
  }

  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
    callback: (err: Error | null, bytesRead?: number) => void,
  ): void {
    const requestEnd = position + length;
    const copyOut = (pieces: Buffer[]): boolean => {
      let at = offset;
      for (const piece of pieces) {
        piece.copy(buffer, at);
        at += piece.length;
      }
      return at - offset === length;
    };
    const cached = this.cachedPieces(position, requestEnd);
    if (copyOut(cached)) {
      setImmediate(() => callback(null, length));
      return;
    }
    // fetch only what the cache lacks: skip the cached prefix, stop at a
    // cached suffix (yauzl's EOCD read may just exceed the tail), and
    // otherwise widen so the next header read is free — to exactly the hinted
    // entry when the hint covers this read, else by CHUNK_BYTES — but never
    // into bytes already cached beyond the request
    const from =
      position + cached.reduce((sum, piece) => sum + piece.length, 0);
    const suffixStart = this.cachedSuffixStart(requestEnd);
    let end: number;
    if (suffixStart !== null && suffixStart > from) {
      end = suffixStart;
    } else {
      const hinted =
        this.hint !== null &&
        position >= this.hint.start &&
        requestEnd <= this.hint.end;
      end = hinted
        ? (this.hint as { end: number }).end
        : Math.max(requestEnd, from + CHUNK_BYTES);
      end = Math.min(end, this.totalSize);
      const next = this.nextCachedStart(requestEnd);
      if (next !== null && next < end) end = next;
    }
    this.fetchBuffer(from, end).then(
      (data) => {
        this.addChunk(from, data);
        if (!copyOut(this.cachedPieces(position, requestEnd))) {
          callback(new Error('range read did not cover the requested bytes'));
          return;
        }
        callback(null, length);
      },
      (error) => callback(error),
    );
  }
}

/** End-of-central-directory record: where the central directory lives. */
const EOCD_SIGNATURE = 0x06054b50;
const EOCD_SIZE = 22;

export function parseEndOfCentralDirectory(
  tail: Buffer,
): { cdOffset: number; cdSize: number } | null {
  for (let i = tail.length - EOCD_SIZE; i >= 0; i--) {
    if (tail.readUInt32LE(i) !== EOCD_SIGNATURE) continue;
    const commentLength = tail.readUInt16LE(i + 20);
    if (i + EOCD_SIZE + commentLength !== tail.length) continue;
    const cdSize = tail.readUInt32LE(i + 12);
    const cdOffset = tail.readUInt32LE(i + 16);
    // zip64 markers: let yauzl resolve the real values itself
    if (cdSize === 0xffffffff || cdOffset === 0xffffffff) return null;
    return { cdOffset, cdSize };
  }
  return null;
}

export type RemoteZip =
  | { kind: 'zip'; zipFile: ZipFile; reader: HttpRangeReader }
  /** the server ignored Range: the whole archive is streaming in `response` */
  | { kind: 'full'; response: Response };

/**
 * Open a remote zip by fetching its tail (EOCD + central directory for
 * typical archives) and letting yauzl read the rest on demand.
 */
export async function openRemoteZip(
  url: string,
  options: RangeOptions = {},
): Promise<RemoteZip> {
  const timeoutMs = timeoutFor(TAIL_BYTES, options);
  let response: Response;
  try {
    response = await webFetch(url, {
      headers: { Range: `bytes=-${TAIL_BYTES}`, 'Accept-Encoding': 'identity' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw describeAbort(error, `bytes=-${TAIL_BYTES}`, timeoutMs);
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`HTTP ${response.status}`);
  }
  if (response.status !== 206) return { kind: 'full', response };
  const range = parseContentRange(response.headers.get('content-range'));
  if (!range) {
    await response.body.cancel().catch(() => {});
    throw new Error(
      `unexpected Content-Range ${response.headers.get('content-range')}`,
    );
  }
  let data: Buffer;
  try {
    data = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    throw describeAbort(error, `bytes=-${TAIL_BYTES}`, timeoutMs);
  }
  if (data.length !== range.end - range.start + 1) {
    throw new Error(
      `tail returned ${data.length} bytes, expected ${range.end - range.start + 1}`,
    );
  }
  const reader = new HttpRangeReader(
    url,
    range.total,
    { start: range.start, data },
    { ...options, ifRange: rangeValidator(response.headers) },
  );
  reader.requests = 1;
  reader.fetchedBytes = data.length;
  // Large archives (apk / ipa with thousands of files) keep their central
  // directory well before the tail; yauzl would otherwise page it in with one
  // sequential request per CHUNK_BYTES. Fetch the missing part at once — one
  // buffer of exactly its size — as long as the EOCD describes a directory
  // that ends inside the tail (a corrupt record could claim the whole file).
  const eocd = parseEndOfCentralDirectory(data);
  if (
    eocd &&
    eocd.cdOffset < range.start &&
    eocd.cdOffset + eocd.cdSize >= range.start &&
    eocd.cdOffset + eocd.cdSize <= range.total - EOCD_SIZE
  ) {
    await reader.prefetch(eocd.cdOffset, range.start);
  }
  const zipFile = await new Promise<ZipFile>((resolve, reject) => {
    fromRandomAccessReader(
      reader,
      range.total,
      { lazyEntries: true, autoClose: false },
      (err, file) => (err ? reject(err) : resolve(file)),
    );
  });
  return { kind: 'zip', zipFile, reader };
}

/** `reader.read` as a promise */
function readAt(
  reader: HttpRangeReader,
  position: number,
  length: number,
): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  return new Promise((resolve, reject) =>
    reader.read(buffer, 0, length, position, (error) =>
      error ? reject(error) : resolve(buffer),
    ),
  );
}

/** The first `bytes` of `entry`, read through `reader` without its body. */
async function remoteEntryHead(
  reader: HttpRangeReader,
  entry: Entry,
  bytes: number,
): Promise<Buffer> {
  const start = entry.relativeOffsetOfLocalHeader;
  const dataOffset = dataOffsetFromLocalHeader(
    await readAt(reader, start, LOCAL_HEADER_SIZE),
    start,
  );
  const size = headProbeSize(
    entry.compressedSize,
    entry.compressionMethod,
    bytes,
  );
  if (size <= 0) return Buffer.alloc(0);
  return decodeEntryHead(
    await readAt(reader, dataOffset, size),
    entry.compressionMethod,
    bytes,
  );
}

/** Look at the head of the matched entry before its body is fetched. */
export interface EntryHeadCheck {
  bytes: number;
  /** throw to abandon the entry; the error is passed on as is */
  check: (head: Buffer) => void;
}

/**
 * Read the first matching entry of an opened remote zip, then close it. With
 * `reader` given, the entry's header and data are fetched in one request —
 * or, with `head` too, its first bytes are checked first (header and head
 * share one small request, the rest of the body follows only if they pass).
 */
export function readRemoteZipEntry(
  zipFile: ZipFile,
  matches: (name: string) => boolean,
  reader?: HttpRangeReader,
  head?: EntryHeadCheck,
): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error: Error | null, result: Buffer | null = null) => {
      if (settled) return;
      settled = true;
      zipFile.close();
      error ? reject(error) : resolve(result);
    };
    zipFile.on('error', (error) => finish(error));
    zipFile.on('end', () => finish(null, null));
    zipFile.on('entry', (entry: Entry) => {
      if (!matches(entry.fileName)) {
        zipFile.readEntry();
        return;
      }
      const probe =
        reader && head
          ? remoteEntryHead(reader, entry, head.bytes).then(head.check)
          : // without a probe the header read may take the body along
            Promise.resolve(reader?.hintEntry(entry));
      probe
        .then(() => readEntry(entry, zipFile))
        .then(
          (data) => finish(null, data),
          (error) => finish(error),
        );
    });
    zipFile.readEntry();
  });
}
