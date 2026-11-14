import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { deflateRawSync } from 'zlib';
import { enumZipEntries, readEntry } from '../src/utils/zip-entries';
import {
  crc32Update,
  fitsRawZip,
  RawZipWriter,
} from '../src/utils/zip-raw-writer';

describe('RawZipWriter', () => {
  let dir = '';
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rnu-raw-zip-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('crc32 matches the reference vector and chains across chunks', () => {
    expect(crc32Update(0, Buffer.from('123456789'))).toBe(0xcbf43926);
    const whole = crc32Update(0, Buffer.from('hello world'));
    const chained = crc32Update(
      crc32Update(0, Buffer.from('hello ')),
      Buffer.from('world'),
    );
    expect(chained).toBe(whole);
  });

  test('fitsRawZip refuses zip64-sized sources', () => {
    expect(fitsRawZip(1024, 10)).toBe(true);
    expect(fitsRawZip(0xffffffff, 10)).toBe(false);
    expect(fitsRawZip(1024, 0xffff)).toBe(false);
  });

  test('writes deflated raw data and stored files that yauzl reads back', async () => {
    const output = path.join(dir, 'out.zip');
    const writer = new RawZipWriter(output);
    const payload = Buffer.from('payload '.repeat(1000));
    const deflated = deflateRawSync(payload);
    await writer.addRawEntry(
      {
        fileName: 'dir/deflated.txt',
        compressionMethod: 8,
        crc32: crc32Update(0, payload),
        compressedSize: deflated.length,
        uncompressedSize: payload.length,
        lastModFileTime: 0x4d00,
        lastModFileDate: 0x5c21,
        generalPurposeBitFlag: 0x0808, // data-descriptor bit must be dropped
      },
      Readable.from([deflated.subarray(0, 100), deflated.subarray(100)]),
    );
    const local = path.join(dir, 'local.bin');
    fs.writeFileSync(local, Buffer.alloc(3000, 9));
    await writer.addStoredFile(local, 'stored/名字.bin');
    await writer.end();

    const seen: Record<
      string,
      { method: number; flags: number; data: Buffer }
    > = {};
    await enumZipEntries(output, async (entry, zipFile) => {
      seen[entry.fileName] = {
        method: entry.compressionMethod,
        flags: entry.generalPurposeBitFlag,
        data: await readEntry(entry, zipFile),
      };
    });
    expect(Object.keys(seen).sort()).toEqual([
      'dir/deflated.txt',
      'stored/名字.bin',
    ]);
    expect(seen['dir/deflated.txt'].method).toBe(8);
    expect(seen['dir/deflated.txt'].flags & 0x8).toBe(0);
    expect(seen['dir/deflated.txt'].flags & 0x800).toBe(0x800);
    expect(seen['dir/deflated.txt'].data.equals(payload)).toBe(true);
    expect(seen['stored/名字.bin'].method).toBe(0);
    expect(seen['stored/名字.bin'].data.equals(Buffer.alloc(3000, 9))).toBe(
      true,
    );
  });

  test('a short read is an error and abort removes the partial file', async () => {
    const output = path.join(dir, 'short.zip');
    const writer = new RawZipWriter(output);
    await expect(
      writer.addRawEntry(
        {
          fileName: 'x',
          compressionMethod: 0,
          crc32: 0,
          compressedSize: 10,
          uncompressedSize: 10,
          lastModFileTime: 0,
          lastModFileDate: 0x21,
        },
        Readable.from([Buffer.alloc(4)]),
      ),
    ).rejects.toThrow('expected 10');
    await writer.abort();
    expect(fs.existsSync(output)).toBe(false);
  });
});
