/**
 * [INPUT]: 依赖 ZIP Range 读取器、Hermes base 获取、真实 ZIP 与隔离 HTTP Range 服务
 * [OUTPUT]: 验证条目定位/缓存请求预算、对象验证器、Range 回退、Hash 失败封闭和传输期限
 * [POS]: CLI 远程基线读取的传输回归，以本地服务校验实际字节与请求次序
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { fromRandomAccessReader, type ZipFile as YauzlZipFile } from 'yauzl';
import { ZipFile } from 'yazl';
import { inflateRawSync } from 'zlib';
import { sha256Hex } from '../src/utils/hash';
import {
  BundleHashMismatchError,
  bundleEntryMatcher,
  fetchBaseBundle,
} from '../src/utils/hermes-base';
import {
  bundleLocationFields,
  fetchZipEntryData,
  HttpRangeReader,
  locateZipEntry,
  openRemoteZip,
  parseContentRange,
  parseEndOfCentralDirectory,
  RangeUnsupportedError,
  readRemoteZipEntry,
  readZipEntryWithLocation,
  ZIP_DEFLATED,
  ZIP_STORED,
} from '../src/utils/zip-range';

function mkTemp(prefix: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function writeZip(
  zipPath: string,
  entries: Record<string, { data: Buffer; compress?: boolean }>,
) {
  const zip = new ZipFile();
  for (const [name, { data, compress }] of Object.entries(entries)) {
    zip.addBuffer(data, name, { compress: compress ?? true });
  }
  zip.end();
  await new Promise<void>((resolve, reject) => {
    zip.outputStream
      .pipe(fs.createWriteStream(zipPath))
      .on('close', () => resolve())
      .on('error', reject);
  });
}

interface ServeOptions {
  /** validators announced on every response and honoured for If-Range */
  etag?: string;
  lastModified?: string;
  /** called with the number of earlier requests before each one is served */
  onRequest?: (count: number) => void;
  /** never answer */
  hang?: boolean;
}

/** Static file server; `ranges: false` answers every request with 200. */
function serveFiles(dir: string, ranges = true, opts: ServeOptions = {}) {
  const log: string[] = [];
  const ifRange: (string | null)[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const file = path.join(dir, new URL(req.url).pathname);
      if (!fs.existsSync(file)) return new Response('nope', { status: 404 });
      opts.onRequest?.(log.length);
      if (opts.hang) return new Promise<Response>(() => {});
      const data = fs.readFileSync(file);
      const range = req.headers.get('range');
      log.push(range ?? 'full');
      ifRange.push(req.headers.get('if-range'));
      const validators: Record<string, string> = {};
      if (opts.etag) validators.ETag = opts.etag;
      if (opts.lastModified) validators['Last-Modified'] = opts.lastModified;
      const current = opts.etag?.startsWith('W/')
        ? opts.lastModified
        : (opts.etag ?? opts.lastModified);
      const condition = req.headers.get('if-range');
      // a stale If-Range means the object changed: answer with the whole body
      if (!ranges || !range || (condition && condition !== current)) {
        return new Response(data, { headers: validators });
      }
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) return new Response('bad range', { status: 416 });
      let start: number;
      let end: number;
      if (match[1] === '') {
        start = Math.max(0, data.length - Number(match[2]));
        end = data.length - 1;
      } else {
        start = Number(match[1]);
        end = match[2] === '' ? data.length - 1 : Number(match[2]);
      }
      if (start >= data.length || end < start)
        return new Response('bad range', { status: 416 });
      end = Math.min(end, data.length - 1);
      return new Response(data.subarray(start, end + 1), {
        status: 206,
        headers: {
          ...validators,
          'Content-Range': `bytes ${start}-${end}/${data.length}`,
          'Content-Length': String(end - start + 1),
        },
      });
    },
  });
  return {
    url: (name: string) => `http://127.0.0.1:${server.port}/${name}`,
    log,
    /** the If-Range header of each request, in `log` order */
    ifRange,
    stop: () => server.stop(true),
  };
}

/** `[start, end]` of a `bytes=start-end` request */
function span(rangeHeader: string): [number, number] {
  const match = /^bytes=(\d+)-(\d+)$/.exec(rangeHeader)!;
  return [Number(match[1]), Number(match[2])];
}

function chunksOf(reader: HttpRangeReader): [number, number][] {
  return (reader as any).chunks.map((c: any) => [c.start, c.data.length]);
}

function fakeHbc(version: number, payload: string): Buffer {
  const buf = Buffer.alloc(128 + payload.length);
  Buffer.from('c61fbc03c103191f', 'hex').copy(buf, 0);
  buf.writeUInt32LE(version, 8);
  buf.write(payload, 128);
  return buf;
}

describe('parseContentRange', () => {
  test('accepts bytes a-b/total and rejects malformed values', () => {
    expect(parseContentRange('bytes 10-19/100')).toEqual({
      start: 10,
      end: 19,
      total: 100,
    });
    expect(parseContentRange('bytes 0-99/100')).toEqual({
      start: 0,
      end: 99,
      total: 100,
    });
    expect(parseContentRange('bytes */100')).toBeNull();
    expect(parseContentRange('bytes 10-9/100')).toBeNull();
    expect(parseContentRange('bytes 0-100/100')).toBeNull();
    expect(parseContentRange(null)).toBeNull();
  });
});

describe('zip-range', () => {
  let dir: string;
  const bundle = fakeHbc(98, 'bundle '.repeat(2000));
  const assets = Buffer.alloc(300 * 1024, 7);
  beforeEach(async () => {
    dir = mkTemp('rnu-zip-range-');
    await writeZip(path.join(dir, 'deflate.ppk'), {
      'assets/big.bin': { data: assets, compress: false },
      'index.bundlejs': { data: bundle },
      'assets/tail.bin': { data: assets, compress: false },
    });
    await writeZip(path.join(dir, 'stored.ppk'), {
      'index.bundlejs': { data: bundle, compress: false },
    });
    await writeZip(path.join(dir, 'native.apk'), {
      'assets/big.bin': { data: assets, compress: false },
      'assets/index.android.bundle': { data: bundle },
    });
  });
  afterEach(() => {
    fs.removeSync(dir);
  });

  test('locateZipEntry points at the compressed bytes of the entry', async () => {
    const ppk = path.join(dir, 'deflate.ppk');
    const location = await locateZipEntry(ppk, (n) => n === 'index.bundlejs');
    expect(location?.compressionMethod).toBe(ZIP_DEFLATED);
    expect(location?.uncompressedSize).toBe(bundle.length);
    const file = fs.readFileSync(ppk);
    const raw = file.subarray(
      location!.dataOffset,
      location!.dataOffset + location!.compressedSize,
    );
    expect(inflateRawSync(raw).equals(bundle)).toBe(true);

    const stored = await locateZipEntry(
      path.join(dir, 'stored.ppk'),
      (n) => n === 'index.bundlejs',
    );
    expect(stored?.compressionMethod).toBe(ZIP_STORED);
    expect(stored?.compressedSize).toBe(bundle.length);
    const storedFile = fs.readFileSync(path.join(dir, 'stored.ppk'));
    expect(
      storedFile
        .subarray(stored!.dataOffset, stored!.dataOffset + bundle.length)
        .equals(bundle),
    ).toBe(true);

    expect(await locateZipEntry(ppk, (n) => n === 'missing')).toBeNull();
  });

  test('fetchZipEntryData downloads only the located bytes', async () => {
    const server = serveFiles(dir);
    try {
      const ppk = path.join(dir, 'deflate.ppk');
      const location = (await locateZipEntry(
        ppk,
        (n) => n === 'index.bundlejs',
      ))!;
      const result = await fetchZipEntryData(
        server.url('deflate.ppk'),
        location,
      );
      expect(result.data.equals(bundle)).toBe(true);
      expect(result.fetchedBytes).toBe(location.compressedSize);
      expect(result.totalBytes).toBe(fs.statSync(ppk).size);
      expect(server.log).toEqual([
        `bytes=${location.dataOffset}-${location.dataOffset + location.compressedSize - 1}`,
      ]);
      // a wrong location yields garbage, not the bundle
      await expect(
        fetchZipEntryData(server.url('deflate.ppk'), {
          ...location,
          dataOffset: location.dataOffset + 1,
        }),
      ).rejects.toThrow();
    } finally {
      server.stop();
    }
  });

  test('openRemoteZip reads an entry through a few Range requests', async () => {
    const server = serveFiles(dir);
    try {
      const remote = await openRemoteZip(server.url('native.apk'));
      expect(remote.kind).toBe('zip');
      if (remote.kind !== 'zip') throw new Error('unreachable');
      const data = await readRemoteZipEntry(
        remote.zipFile,
        bundleEntryMatcher('apk'),
      );
      expect(data?.equals(bundle)).toBe(true);
      const total = fs.statSync(path.join(dir, 'native.apk')).size;
      expect(remote.reader.totalSize).toBe(total);
      // tail + local header chunk (+ data when not covered): far below the archive
      expect(server.log.length).toBeLessThanOrEqual(3);
      expect(server.log[0]).toBe('bytes=-65577');
      expect(remote.reader.fetchedBytes).toBeLessThan(total / 2);

      const missing = await openRemoteZip(server.url('deflate.ppk'));
      if (missing.kind !== 'zip') throw new Error('unreachable');
      expect(
        await readRemoteZipEntry(missing.zipFile, (n) => n === 'nope'),
      ).toBeNull();
    } finally {
      server.stop();
    }
  });

  test('openRemoteZip hands back the full response when Range is ignored', async () => {
    const server = serveFiles(dir, false);
    try {
      const remote = await openRemoteZip(server.url('native.apk'));
      expect(remote.kind).toBe('full');
      if (remote.kind !== 'full') throw new Error('unreachable');
      const body = Buffer.from(await remote.response.arrayBuffer());
      expect(body.equals(fs.readFileSync(path.join(dir, 'native.apk')))).toBe(
        true,
      );
    } finally {
      server.stop();
    }
  });

  describe('fetchBaseBundle', () => {
    const record = (url: string, extra: Record<string, unknown> = {}) => ({
      versionId: 1,
      hash: 'key',
      bundleHash: sha256Hex(bundle),
      bytecodeVersion: 98,
      url,
      ...extra,
    });

    test('uses the reported location with a single request', async () => {
      const server = serveFiles(dir);
      const messages: string[] = [];
      try {
        const location = (await locateZipEntry(
          path.join(dir, 'deflate.ppk'),
          (n) => n === 'index.bundlejs',
        ))!;
        const fetched = await fetchBaseBundle(
          record(server.url('deflate.ppk'), {
            bundleOffset: location.dataOffset,
            bundleCompressedSize: location.compressedSize,
            bundleCompression: location.compressionMethod,
          }),
          'ppk',
          path.join(dir, 'archive.ppk'),
          (m) => messages.push(m),
        );
        expect(fetched?.transport).toBe('range-entry');
        expect(fetched?.bundle.equals(bundle)).toBe(true);
        expect(server.log.length).toBe(1);
        expect(messages).toEqual([]);
        expect(fs.existsSync(path.join(dir, 'archive.ppk'))).toBe(false);
      } finally {
        server.stop();
      }
    });

    test('a stale location falls back to the central directory, then verifies', async () => {
      const server = serveFiles(dir);
      const messages: string[] = [];
      try {
        const fetched = await fetchBaseBundle(
          record(server.url('deflate.ppk'), {
            bundleOffset: 5,
            bundleCompressedSize: 100,
            bundleCompression: ZIP_DEFLATED,
          }),
          'ppk',
          path.join(dir, 'archive.ppk'),
          (m) => messages.push(m),
        );
        expect(fetched?.transport).toBe('range-zip');
        expect(fetched?.bundle.equals(bundle)).toBe(true);
        expect(messages.length).toBe(1);
        expect(messages[0]).toContain('entry range');
      } finally {
        server.stop();
      }
    });

    test('without a location any zip artifact is read through Range', async () => {
      const server = serveFiles(dir);
      try {
        const fetched = await fetchBaseBundle(
          record(server.url('native.apk'), { artifactType: 'apk' }),
          'apk',
          path.join(dir, 'archive.apk'),
        );
        expect(fetched?.transport).toBe('range-zip');
        expect(fetched?.bundle.equals(bundle)).toBe(true);
        expect(fs.existsSync(path.join(dir, 'archive.apk'))).toBe(false);
      } finally {
        server.stop();
      }
    });

    test('a server that ignores Range costs exactly one full download', async () => {
      const server = serveFiles(dir, false);
      const messages: string[] = [];
      try {
        const location = (await locateZipEntry(
          path.join(dir, 'deflate.ppk'),
          (n) => n === 'index.bundlejs',
        ))!;
        const fetched = await fetchBaseBundle(
          record(server.url('deflate.ppk'), {
            bundleOffset: location.dataOffset,
            bundleCompressedSize: location.compressedSize,
            bundleCompression: location.compressionMethod,
          }),
          'ppk',
          path.join(dir, 'archive.ppk'),
          (m) => messages.push(m),
        );
        expect(fetched?.transport).toBe('full');
        expect(fetched?.bundle.equals(bundle)).toBe(true);
        expect(server.log.length).toBe(1);
        expect(messages.length).toBe(1);
        expect(fs.existsSync(path.join(dir, 'archive.ppk'))).toBe(true);
      } finally {
        server.stop();
      }
    });

    test('a bundleHash mismatch of the entry read over Range is final (no full download)', async () => {
      const server = serveFiles(dir);
      const messages: string[] = [];
      try {
        await expect(
          fetchBaseBundle(
            record(server.url('deflate.ppk'), { bundleHash: 'f'.repeat(64) }),
            'ppk',
            path.join(dir, 'archive.ppk'),
            (m) => messages.push(m),
          ),
        ).rejects.toBeInstanceOf(BundleHashMismatchError);
        // the directory transport read the real entry: that verdict stands,
        // no fallback to the whole archive is announced or performed
        expect(messages.some((m) => m.includes('whole package'))).toBe(false);
        expect(server.log.includes('full')).toBe(false);
      } finally {
        server.stop();
      }
    });

    test('a missing object fails instead of falling back', async () => {
      const server = serveFiles(dir);
      try {
        await expect(
          fetchBaseBundle(
            record(server.url('missing.ppk')),
            'ppk',
            path.join(dir, 'archive.ppk'),
          ),
        ).rejects.toThrow();
      } finally {
        server.stop();
      }
    });
  });
});

describe('zip-range request economy', () => {
  let dir: string;
  // larger than the 64 KB header chunk, so the data needs its own bytes
  const bigBundle = fakeHbc(98, 'bundle '.repeat(40000));
  beforeEach(async () => {
    dir = mkTemp('rnu-zip-range-econ-');
    await writeZip(path.join(dir, 'big.apk'), {
      'assets/pad.bin': { data: Buffer.alloc(200 * 1024, 3), compress: false },
      'assets/index.android.bundle': { data: bigBundle, compress: false },
      'assets/tail.bin': { data: Buffer.alloc(100 * 1024, 4), compress: false },
    });
    // thousands of entries push the central directory far before the tail
    const many: Record<string, { data: Buffer; compress?: boolean }> = {};
    for (let i = 0; i < 4000; i++) {
      many[`lib/arm64/file-${i}.txt`] = { data: Buffer.from('x') };
    }
    many['assets/index.android.bundle'] = { data: bigBundle };
    many['assets/zzz.bin'] = {
      data: Buffer.alloc(150 * 1024, 5),
      compress: false,
    };
    await writeZip(path.join(dir, 'many.apk'), many);
  });
  afterEach(() => {
    fs.removeSync(dir);
  });

  test('parseEndOfCentralDirectory finds the directory from the tail', () => {
    const file = fs.readFileSync(path.join(dir, 'big.apk'));
    const eocd = parseEndOfCentralDirectory(file.subarray(-1024));
    expect(eocd).not.toBeNull();
    // the central directory starts with its own signature
    expect(file.readUInt32LE(eocd!.cdOffset)).toBe(0x02014b50);
    expect(eocd!.cdOffset + eocd!.cdSize).toBe(file.length - 22);
    expect(parseEndOfCentralDirectory(Buffer.alloc(10))).toBeNull();
  });

  test('an entry beyond the header chunk costs one request with the hint, two without', async () => {
    const server = serveFiles(dir);
    try {
      const hinted = await openRemoteZip(server.url('big.apk'));
      if (hinted.kind !== 'zip') throw new Error('unreachable');
      const data = await readRemoteZipEntry(
        hinted.zipFile,
        bundleEntryMatcher('apk'),
        hinted.reader,
      );
      expect(data?.equals(bigBundle)).toBe(true);
      // tail + (local header .. data) in one go
      expect(server.log.length).toBe(2);
      expect(hinted.reader.requests).toBe(2);
      expect(hinted.reader.fetchedBytes).toBeLessThan(
        bigBundle.length + 80 * 1024,
      );

      server.log.length = 0;
      const plain = await openRemoteZip(server.url('big.apk'));
      if (plain.kind !== 'zip') throw new Error('unreachable');
      const again = await readRemoteZipEntry(
        plain.zipFile,
        bundleEntryMatcher('apk'),
      );
      expect(again?.equals(bigBundle)).toBe(true);
      // tail + 64 KB header chunk + the rest of the data (prefix reused)
      expect(server.log.length).toBe(3);
      const total = fs.statSync(path.join(dir, 'big.apk')).size;
      expect(plain.reader.fetchedBytes).toBeLessThan(total);
      // the third request starts after the cached 64 KB prefix, not at the data offset
      const location = (await locateZipEntry(
        path.join(dir, 'big.apk'),
        bundleEntryMatcher('apk'),
      ))!;
      const third = /^bytes=(\d+)-/.exec(server.log[2])!;
      expect(Number(third[1])).toBeGreaterThan(location.dataOffset);
    } finally {
      server.stop(true);
    }
  });

  test('a large central directory is prefetched in one request', async () => {
    const file = fs.readFileSync(path.join(dir, 'many.apk'));
    const eocd = parseEndOfCentralDirectory(file.subarray(-65577))!;
    expect(file.length - eocd.cdOffset).toBeGreaterThan(65577);
    const server = serveFiles(dir);
    try {
      const remote = await openRemoteZip(server.url('many.apk'));
      if (remote.kind !== 'zip') throw new Error('unreachable');
      expect(server.log[0]).toBe('bytes=-65577');
      expect(server.log[1]).toBe(
        `bytes=${eocd.cdOffset}-${file.length - 65577 - 1}`,
      );
      const data = await readRemoteZipEntry(
        remote.zipFile,
        bundleEntryMatcher('apk'),
        remote.reader,
      );
      expect(data?.equals(bigBundle)).toBe(true);
      // tail, directory, entry — never one request per 64 KB of directory
      expect(server.log.length).toBe(3);
    } finally {
      server.stop(true);
    }
  });

  test('HttpRangeReader keeps touching chunks apart, merges overlaps and reads across', async () => {
    const reader = new HttpRangeReader('http://unused', 100);
    reader.addChunk(10, Buffer.from('abc'));
    reader.addChunk(13, Buffer.from('def'));
    reader.addChunk(0, Buffer.from('0123456789'));
    reader.addChunk(30, Buffer.from('zz'));
    // touching chunks are not copied into one
    expect(chunksOf(reader)).toEqual([
      [0, 10],
      [10, 3],
      [13, 3],
      [30, 2],
    ]);
    // overlapping data merges what it touches, and the newest bytes win
    reader.addChunk(12, Buffer.from('XY'));
    expect(chunksOf(reader)).toEqual([
      [0, 10],
      [10, 6],
      [30, 2],
    ]);
    expect((reader as any).chunks[1].data.toString()).toBe('abXYef');
    // a read spanning touching chunks is a cache hit
    const buf = Buffer.alloc(16);
    const bytesRead = await new Promise<number | undefined>((resolve, reject) =>
      reader.read(buf, 0, 16, 0, (err, n) => (err ? reject(err) : resolve(n))),
    );
    expect(bytesRead).toBe(16);
    expect(buf.toString()).toBe('0123456789abXYef');
    const parts: Buffer[] = [];
    for await (const part of reader._readStreamForRange(8, 14)) {
      parts.push(part);
    }
    expect(Buffer.concat(parts).toString()).toBe('89abXY');
    expect(reader.requests).toBe(0);
  });

  test('a hinted entry is held once: its own chunk, handed back as a view', async () => {
    const server = serveFiles(dir);
    try {
      const remote = await openRemoteZip(server.url('big.apk'));
      if (remote.kind !== 'zip') throw new Error('unreachable');
      const data = (await readRemoteZipEntry(
        remote.zipFile,
        bundleEntryMatcher('apk'),
        remote.reader,
      ))!;
      expect(data.equals(bigBundle)).toBe(true);
      // tail + the entry's chunk, not merged into one allocation
      const chunks = (remote.reader as any).chunks as {
        start: number;
        data: Buffer;
      }[];
      expect(chunks.length).toBe(2);
      expect(chunks[0].data.length).toBeLessThan(bigBundle.length + 8 * 1024);
      // the stored entry is a view into that chunk, not a copy
      expect(data.buffer).toBe(chunks[0].data.buffer);
    } finally {
      server.stop();
    }
  });

  test('a hinted read stops at cached bytes and skips the 64 KB floor', async () => {
    const server = serveFiles(dir);
    try {
      // the last entry runs into the cached tail: fetch up to it, not past it
      const file = fs.readFileSync(path.join(dir, 'big.apk'));
      const tailStart = file.length - 65577;
      const remote = await openRemoteZip(server.url('big.apk'));
      if (remote.kind !== 'zip') throw new Error('unreachable');
      const data = await readRemoteZipEntry(
        remote.zipFile,
        (n) => n === 'assets/tail.bin',
        remote.reader,
      );
      expect(data?.equals(Buffer.alloc(100 * 1024, 4))).toBe(true);
      expect(server.log.length).toBe(2);
      const location = (await locateZipEntry(
        path.join(dir, 'big.apk'),
        (n) => n === 'assets/tail.bin',
      ))!;
      const [start, end] = span(server.log[1]);
      expect(start).toBeLessThan(location.dataOffset);
      expect(end).toBe(tailStart - 1);
      expect(remote.reader.fetchedBytes).toBe(file.length - start);

      // a tiny hinted entry costs a tiny request, not a 64 KB one
      server.log.length = 0;
      const many = await openRemoteZip(server.url('many.apk'));
      if (many.kind !== 'zip') throw new Error('unreachable');
      const tiny = await readRemoteZipEntry(
        many.zipFile,
        (n) => n === 'lib/arm64/file-7.txt',
        many.reader,
      );
      expect(tiny?.toString()).toBe('x');
      expect(server.log.length).toBe(3);
      const [tinyStart, tinyEnd] = span(server.log[2]);
      expect(tinyEnd - tinyStart + 1).toBeLessThan(8 * 1024);
    } finally {
      server.stop();
    }
  });

  test('a paged central directory is cached page by page, never re-fetched or merged', async () => {
    const server = serveFiles(dir);
    try {
      const file = fs.readFileSync(path.join(dir, 'many.apk'));
      const tailStart = file.length - 65577;
      const eocd = parseEndOfCentralDirectory(file.subarray(tailStart))!;
      const missing = tailStart - eocd.cdOffset;
      // no prefetch: yauzl walks the directory through read()
      const reader = new HttpRangeReader(server.url('many.apk'), file.length, {
        start: tailStart,
        data: file.subarray(tailStart),
      });
      const zipFile = await new Promise<YauzlZipFile>((resolve, reject) => {
        fromRandomAccessReader(
          reader,
          file.length,
          { lazyEntries: true, autoClose: false },
          (err, zip) => (err ? reject(err) : resolve(zip)),
        );
      });
      let entries = 0;
      await new Promise<void>((resolve, reject) => {
        zipFile.on('entry', () => {
          entries++;
          zipFile.readEntry();
        });
        zipFile.on('end', resolve);
        zipFile.on('error', reject);
        zipFile.readEntry();
      });
      zipFile.close();
      expect(entries).toBe(4002);
      // one 64 KB page per request, each byte fetched exactly once
      expect(reader.requests).toBe(Math.ceil(missing / (64 * 1024)));
      expect(reader.fetchedBytes).toBe(missing);
      for (const request of server.log) {
        const [start, end] = span(request);
        expect(end - start + 1).toBeLessThanOrEqual(64 * 1024);
      }
      expect(chunksOf(reader).length).toBe(reader.requests + 1);
    } finally {
      server.stop();
    }
  });

  test('readZipEntryWithLocation returns the entry and where it sits', async () => {
    const apk = path.join(dir, 'big.apk');
    const found = await readZipEntryWithLocation(
      apk,
      bundleEntryMatcher('apk'),
    );
    expect(found?.data.equals(bigBundle)).toBe(true);
    expect(found?.location).toEqual(
      (await locateZipEntry(apk, bundleEntryMatcher('apk')))!,
    );
    expect(await readZipEntryWithLocation(apk, () => false)).toBeNull();
    expect(bundleLocationFields(found?.location)).toEqual({
      bundleOffset: found!.location.dataOffset,
      bundleCompressedSize: found!.location.compressedSize,
      bundleCompression: ZIP_STORED,
    });
    expect(bundleLocationFields(null)).toEqual({});
    expect(
      bundleLocationFields({ ...found!.location, compressionMethod: 12 }),
    ).toEqual({});
  });
});

describe('zip-range consistency and deadlines', () => {
  let dir: string;
  const bigBundle = fakeHbc(98, 'bundle '.repeat(40000));
  beforeEach(async () => {
    dir = mkTemp('rnu-zip-range-cons-');
    await writeZip(path.join(dir, 'big.apk'), {
      'assets/pad.bin': { data: Buffer.alloc(200 * 1024, 3), compress: false },
      'assets/index.android.bundle': { data: bigBundle, compress: false },
      'assets/tail.bin': { data: Buffer.alloc(100 * 1024, 4), compress: false },
    });
  });
  afterEach(() => {
    fs.removeSync(dir);
  });

  const readBundle = async (url: string) => {
    const remote = await openRemoteZip(url);
    if (remote.kind !== 'zip') throw new Error('unreachable');
    return readRemoteZipEntry(
      remote.zipFile,
      bundleEntryMatcher('apk'),
      remote.reader,
    );
  };

  test('later requests carry If-Range with the validator of the tail response', async () => {
    const strong = serveFiles(dir, true, { etag: '"v1"' });
    try {
      // no hint: tail, header chunk, data
      const remote = await openRemoteZip(strong.url('big.apk'));
      if (remote.kind !== 'zip') throw new Error('unreachable');
      const data = await readRemoteZipEntry(
        remote.zipFile,
        bundleEntryMatcher('apk'),
      );
      expect(data?.equals(bigBundle)).toBe(true);
      expect(strong.ifRange).toEqual([null, '"v1"', '"v1"']);
    } finally {
      strong.stop();
    }
    // a weak ETag may not be used for If-Range: fall back to Last-Modified
    const lastModified = 'Tue, 01 Jan 2030 00:00:00 GMT';
    const weak = serveFiles(dir, true, { etag: 'W/"v1"', lastModified });
    try {
      const data = await readBundle(weak.url('big.apk'));
      expect(data?.equals(bigBundle)).toBe(true);
      expect(weak.ifRange).toEqual([null, lastModified]);
    } finally {
      weak.stop();
    }
    // a single located request has nothing to compare against
    const single = serveFiles(dir, true, { etag: '"v1"' });
    try {
      const location = (await locateZipEntry(
        path.join(dir, 'big.apk'),
        bundleEntryMatcher('apk'),
      ))!;
      await fetchZipEntryData(single.url('big.apk'), location);
      expect(single.ifRange).toEqual([null]);
    } finally {
      single.stop();
    }
  });

  test('an object replaced between requests answers 200 and falls back to the full download', async () => {
    const opts: ServeOptions = { etag: '"v1"' };
    opts.onRequest = (count) => {
      if (count === 1) opts.etag = '"v2"';
    };
    const server = serveFiles(dir, true, opts);
    try {
      const error = await readBundle(server.url('big.apk')).then(
        () => null,
        (e) => e,
      );
      expect(error).toBeInstanceOf(RangeUnsupportedError);
      expect(server.log).toEqual(['bytes=-65577', server.log[1]]);
      expect(server.ifRange[1]).toBe('"v1"');
      // the 200 body is the whole archive, so the caller finishes from it
      opts.etag = '"v1"';
      server.log.length = 0;
      const fetched = await fetchBaseBundle(
        {
          versionId: 1,
          hash: 'key',
          bundleHash: sha256Hex(bigBundle),
          bytecodeVersion: 98,
          url: server.url('big.apk'),
          artifactType: 'apk',
        },
        'apk',
        path.join(dir, 'archive.apk'),
      );
      expect(fetched?.transport).toBe('full');
      expect(fetched?.bundle.equals(bigBundle)).toBe(true);
      expect(server.log.length).toBe(2);
    } finally {
      server.stop();
    }
  });

  test('an archive whose size changed is rejected instead of read across versions', async () => {
    const server = serveFiles(dir);
    try {
      fs.copyFileSync(path.join(dir, 'big.apk'), path.join(dir, 'grow.apk'));
      const remote = await openRemoteZip(server.url('grow.apk'));
      if (remote.kind !== 'zip') throw new Error('unreachable');
      fs.appendFileSync(path.join(dir, 'grow.apk'), Buffer.alloc(16));
      const error = await readRemoteZipEntry(
        remote.zipFile,
        bundleEntryMatcher('apk'),
        remote.reader,
      ).then(
        () => null,
        (e) => e,
      );
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(RangeUnsupportedError);
      expect(error.message).toMatch(/archive size changed/);
    } finally {
      server.stop();
    }
  });

  test('a silent server times out with a plain error', async () => {
    const opts: ServeOptions = {};
    const server = serveFiles(dir, true, opts);
    const quick = {
      headerTimeoutMs: 100,
      dataTimeoutMs: 100,
      dataTimeoutPerMbMs: 0,
    };
    const failure = (p: Promise<unknown>) =>
      p.then(
        () => null,
        (e) => e,
      );
    try {
      opts.hang = true;
      const tail = await failure(openRemoteZip(server.url('big.apk'), quick));
      expect(tail).toBeInstanceOf(Error);
      expect(tail).not.toBeInstanceOf(RangeUnsupportedError);
      expect(tail.message).toMatch(/timed out after 100 ms/);

      const location = (await locateZipEntry(
        path.join(dir, 'big.apk'),
        bundleEntryMatcher('apk'),
      ))!;
      const entry = await failure(
        fetchZipEntryData(server.url('big.apk'), location, quick),
      );
      expect(entry.message).toMatch(/timed out after 100 ms/);

      // the reader inherits the deadlines for its own requests
      opts.hang = false;
      const remote = await openRemoteZip(server.url('big.apk'), quick);
      if (remote.kind !== 'zip') throw new Error('unreachable');
      opts.hang = true;
      const data = await failure(
        readRemoteZipEntry(
          remote.zipFile,
          bundleEntryMatcher('apk'),
          remote.reader,
        ),
      );
      expect(data).not.toBeInstanceOf(RangeUnsupportedError);
      expect(data.message).toMatch(/timed out after 100 ms/);
    } finally {
      server.stop();
    }
  });
});
