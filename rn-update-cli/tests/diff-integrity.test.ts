import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ZipFile as YazlZipFile } from 'yazl';
import {
  diffCommands,
  enumZipEntries,
  readEntry,
  zipEntriesHaveSameContent,
  zipEntryContentKey,
} from '../src/diff';
import type { CommandContext } from '../src/types';

// ---- CRC32 forging -------------------------------------------------------
// CRC32 is affine over GF(2): for any prefix we can compute 4 trailing bytes
// that force the checksum to an arbitrary target. That lets the tests build a
// real crc32 collision between two files of different length, which is the
// exact case a crc-only "moved file" match gets wrong.
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c >>> 0;
}
const CRC_TOP_BYTE_TO_INDEX = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  CRC_TOP_BYTE_TO_INDEX[CRC_TABLE[i] >>> 24] = i;
}
const crcUpdate = (state: number, byte: number) =>
  (CRC_TABLE[(state ^ byte) & 0xff] ^ (state >>> 8)) >>> 0;

function crc32(data: Buffer): number {
  let state = 0xffffffff;
  for (const byte of data) {
    state = crcUpdate(state, byte);
  }
  return (state ^ 0xffffffff) >>> 0;
}

/** 4 bytes to append to `prefix` so that crc32(prefix + suffix) === target */
function forgeCrcSuffix(prefix: Buffer, target: number): Buffer {
  let state = 0xffffffff;
  for (const byte of prefix) {
    state = crcUpdate(state, byte);
  }
  // Walk the 4 update steps backwards: the top byte of each intermediate
  // state pins down which table row was used.
  let wanted = (target ^ 0xffffffff) >>> 0;
  const rows = [0, 0, 0, 0];
  for (let i = 3; i >= 0; i--) {
    const row = CRC_TOP_BYTE_TO_INDEX[wanted >>> 24];
    rows[i] = row;
    wanted = ((wanted ^ CRC_TABLE[row]) << 8) >>> 0;
  }
  const suffix = Buffer.alloc(4);
  for (let i = 0; i < 4; i++) {
    suffix[i] = (state ^ rows[i]) & 0xff;
    state = crcUpdate(state, suffix[i]);
  }
  return suffix;
}

/** A longer payload whose crc32 collides with `short`. */
function collidingLongerContent(short: Buffer, longerBody: string): Buffer {
  const body = Buffer.from(longerBody);
  const longer = Buffer.concat([body, forgeCrcSuffix(body, crc32(short))]);
  if (crc32(longer) !== crc32(short) || longer.length === short.length) {
    throw new Error('crc forge failed');
  }
  return longer;
}

// ---- zip helpers ---------------------------------------------------------
async function createZip(zipPath: string, entries: Record<string, Buffer>) {
  await new Promise<void>((resolve, reject) => {
    const zip = new YazlZipFile();
    zip.outputStream.on('error', reject);
    zip.outputStream
      .pipe(fs.createWriteStream(zipPath))
      .on('close', () => resolve())
      .on('error', reject);
    for (const [name, content] of Object.entries(entries)) {
      zip.addBuffer(content, name);
    }
    zip.end();
  });
}

async function readZipFiles(zipPath: string) {
  const files: Record<string, Buffer> = {};
  await enumZipEntries(zipPath, async (entry, zipFile) => {
    if (!entry.fileName.endsWith('/')) {
      files[entry.fileName] = await readEntry(entry, zipFile);
    }
  });
  return files;
}

async function readZipEntryMeta(zipPath: string) {
  const meta: Record<string, { crc32: number; uncompressedSize: number }> = {};
  await enumZipEntries(zipPath, async (entry) => {
    meta[entry.fileName] = {
      crc32: entry.crc32,
      uncompressedSize: entry.uncompressedSize,
    };
  });
  return meta;
}

function readManifest(files: Record<string, Buffer>) {
  return JSON.parse(files['__diff.json'].toString('utf8')) as {
    copies: Record<string, string>;
    copiesCrc?: Record<string, number>;
    deletes?: Record<string, 1>;
  };
}

describe('zip entry content matching', () => {
  test('content key and equality require crc32 AND uncompressed size', () => {
    const a = { crc32: 0x1234, uncompressedSize: 12 };
    const sameCrcLonger = { crc32: 0x1234, uncompressedSize: 27 };
    const identical = { crc32: 0x1234, uncompressedSize: 12 };
    expect(zipEntryContentKey(a)).toBe('4660:12');
    expect(zipEntryContentKey(a)).toBe(zipEntryContentKey(identical));
    expect(zipEntryContentKey(a)).not.toBe(zipEntryContentKey(sameCrcLonger));
    expect(zipEntriesHaveSameContent(a, identical)).toBe(true);
    expect(zipEntriesHaveSameContent(a, sameCrcLonger)).toBe(false);
    expect(
      zipEntriesHaveSameContent(a, { crc32: 0x4321, uncompressedSize: 12 }),
    ).toBe(false);
  });

  let tempRoot = '';
  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-diff-integrity-'));
  });
  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const short = Buffer.from('move-content');
  const longer = collidingLongerContent(short, 'move-content-but-longer');
  const samePathShort = Buffer.from('same-path-content');
  const samePathLonger = collidingLongerContent(
    samePathShort,
    'same-path-content-but-longer',
  );
  const reallySame = Buffer.from('really-same-content');

  test('hdiff: equal crc32 with different size is not a copy nor unchanged', async () => {
    const originPath = path.join(tempRoot, 'origin.ppk');
    const nextPath = path.join(tempRoot, 'next.ppk');
    const outputPath = path.join(tempRoot, 'out', 'diff.ppk');

    await createZip(originPath, {
      'index.bundlejs': Buffer.from('old-bundle'),
      'moved-source.txt': short,
      'assets/same-path.txt': samePathShort,
      'assets/really-same.txt': reallySame,
    });
    await createZip(nextPath, {
      'index.bundlejs': Buffer.from('new-bundle'),
      'moved/collide.txt': longer,
      'assets/same-path.txt': samePathLonger,
      'assets/really-same.txt': reallySame,
      'moved/really-moved.txt': short,
    });

    // the fixture really is a crc32 collision as seen by the zip reader
    const originMeta = await readZipEntryMeta(originPath);
    const nextMeta = await readZipEntryMeta(nextPath);
    expect(nextMeta['moved/collide.txt'].crc32).toBe(
      originMeta['moved-source.txt'].crc32,
    );
    expect(nextMeta['moved/collide.txt'].uncompressedSize).not.toBe(
      originMeta['moved-source.txt'].uncompressedSize,
    );

    await diffCommands.hdiff({
      args: [originPath, nextPath],
      options: {
        output: outputPath,
        customDiff: () => Buffer.from('patch'),
      },
    } as CommandContext);

    const files = await readZipFiles(outputPath);
    const manifest = readManifest(files);
    // colliding crc, different length: must ship the bytes, never a copy
    expect(manifest.copies['moved/collide.txt']).toBeUndefined();
    expect(Buffer.compare(files['moved/collide.txt'], longer)).toBe(0);
    // same path, colliding crc, different length: not "unchanged"
    expect(nextMeta['assets/same-path.txt'].crc32).toBe(
      originMeta['assets/same-path.txt'].crc32,
    );
    expect(Buffer.compare(files['assets/same-path.txt'], samePathLonger)).toBe(
      0,
    );
    // genuine matches still behave as before
    expect(files['assets/really-same.txt']).toBeUndefined();
    expect(manifest.copies['moved/really-moved.txt']).toBe('moved-source.txt');
    expect(files['moved/really-moved.txt']).toBeUndefined();
  });

  test('hdiffFromApk: equal crc32 with different size is neither copy nor same-path match', async () => {
    const originPath = path.join(tempRoot, 'origin.apk');
    const nextPath = path.join(tempRoot, 'next.ppk');
    const outputPath = path.join(tempRoot, 'out', 'apk-diff.ppk');

    await createZip(originPath, {
      'assets/index.android.bundle': Buffer.from('old-bundle'),
      'res/raw/source.bin': short,
      'assets/same-path.bin': samePathShort,
      'assets/really-same.bin': reallySame,
    });
    await createZip(nextPath, {
      'index.bundlejs': Buffer.from('new-bundle'),
      'assets/collide.bin': longer,
      'assets/same-path.bin': samePathLonger,
      'assets/really-same.bin': reallySame,
    });

    await diffCommands.hdiffFromApk({
      args: [originPath, nextPath],
      options: {
        output: outputPath,
        customDiff: () => Buffer.from('patch'),
      },
    } as CommandContext);

    const files = await readZipFiles(outputPath);
    const manifest = readManifest(files);
    expect(manifest.copies['assets/collide.bin']).toBeUndefined();
    expect(manifest.copiesCrc?.['assets/collide.bin']).toBeUndefined();
    expect(Buffer.compare(files['assets/collide.bin'], longer)).toBe(0);
    expect(manifest.copies['assets/same-path.bin']).toBeUndefined();
    expect(Buffer.compare(files['assets/same-path.bin'], samePathLonger)).toBe(
      0,
    );
    // genuine same-path match keeps the existing manifest format
    expect(manifest.copies['assets/really-same.bin']).toBe('');
    expect(manifest.copiesCrc?.['assets/really-same.bin']).toBe(
      crc32(reallySame),
    );
    expect(files['assets/really-same.bin']).toBeUndefined();
  });
});

describe('diff output cleanup on failure', () => {
  let tempRoot = '';
  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-diff-cleanup-'));
  });
  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  async function buildInputs(kind: 'ppk' | 'apk') {
    const originPath = path.join(tempRoot, `origin.${kind}`);
    const nextPath = path.join(tempRoot, 'next.ppk');
    await createZip(originPath, {
      [kind === 'apk' ? 'assets/index.android.bundle' : 'index.bundlejs']:
        Buffer.from('old-bundle'),
      'assets/keep.txt': Buffer.from('keep'),
    });
    // a fresh payload entry is written to the output before the bundle
    // patch runs, so the partial zip is non-empty when the diff fails
    await createZip(nextPath, {
      'assets/first.bin': Buffer.alloc(64 * 1024, 7),
      'index.bundlejs': Buffer.from('new-bundle'),
      'assets/keep.txt': Buffer.from('keep'),
    });
    return { originPath, nextPath };
  }

  test('hdiff: a failing second pass rethrows and leaves no output file', async () => {
    const { originPath, nextPath } = await buildInputs('ppk');
    const outputPath = path.join(tempRoot, 'out', 'diff.ppk');
    const failure = new Error('diff exploded');

    await expect(
      diffCommands.hdiff({
        args: [originPath, nextPath],
        options: {
          output: outputPath,
          customDiff: () => {
            throw failure;
          },
        },
      } as CommandContext),
    ).rejects.toBe(failure);

    expect(fs.existsSync(outputPath)).toBe(false);
  });

  test('hdiffFromApk: a failing second pass rethrows and leaves no output file', async () => {
    const { originPath, nextPath } = await buildInputs('apk');
    const outputPath = path.join(tempRoot, 'out', 'apk-diff.ppk');

    await expect(
      diffCommands.hdiffFromApk({
        args: [originPath, nextPath],
        options: {
          output: outputPath,
          customDiff: async () => {
            await new Promise((resolve) => setTimeout(resolve, 1));
            throw new Error('async diff exploded');
          },
        },
      } as CommandContext),
    ).rejects.toThrow('async diff exploded');

    expect(fs.existsSync(outputPath)).toBe(false);
  });

  test('a stale output from a previous run is removed when the diff fails', async () => {
    const { originPath, nextPath } = await buildInputs('ppk');
    const outputPath = path.join(tempRoot, 'stale.ppk');
    fs.writeFileSync(outputPath, 'stale partial patch');

    await expect(
      diffCommands.hdiff({
        args: [originPath, nextPath],
        options: {
          output: outputPath,
          customDiff: () => {
            throw new Error('boom');
          },
        },
      } as CommandContext),
    ).rejects.toThrow('boom');

    expect(fs.existsSync(outputPath)).toBe(false);
  });
});
