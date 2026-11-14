/**
 * [INPUT]: 依赖源 ZIP 中央目录、可读流、CRC/尺寸元数据与文件系统
 * [OUTPUT]: 对外提供 RawZipEntry、fitsRawZip、crc32Update 与 RawZipWriter
 * [POS]: CLI 归档快速重打包底座，原样复制压缩条目并显式维护落盘偏移，避免重压缩与 WSL 首块覆盖
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

// A minimal zip writer that copies entries *as stored* — their compressed
// bytes, CRC, sizes and timestamps straight from the source archive's central
// directory — so repacking a subset of an apk / ipa / hap costs disk I/O, not
// a second deflate of every asset (yazl can only add uncompressed data and
// re-deflates it). Plain zip only: no zip64, no data descriptors, no extra
// fields; callers must check `fitsRawZip` before choosing this writer.
import fs from 'fs';
import type { Readable } from 'stream';
import type { Entry } from 'yauzl';
import { remove } from './fs-helpers';

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
const VERSION_NEEDED_DEFAULT = 20;
/** "made by" for entries this writer creates itself: unix, spec 2.0 */
const VERSION_MADE_BY_UNIX = (3 << 8) | 20;
const FLAG_UTF8_NAMES = 0x800;
const FLAG_DATA_DESCRIPTOR = 0x8;
/** general-purpose bits carried over from a copied entry: encryption, deflate strength */
const FLAG_KEEP_MASK = 0x0007;
const MAX_UINT32 = 0xffffffff;
const MAX_UINT16 = 0xffff;
/** external attributes of a plain `-rw-r--r--` file */
const UNIX_REGULAR_FILE_ATTRIBUTES = 0o100644 << 16;

export interface RawZipEntry {
  fileName: string;
  compressionMethod: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  lastModFileTime: number;
  lastModFileDate: number;
  generalPurposeBitFlag?: number;
  versionMadeBy?: number;
  versionNeededToExtract?: number;
  internalFileAttributes?: number;
  externalFileAttributes?: number;
}

/**
 * Whether an archive of `sourceSize` bytes with `entryCount` entries can be
 * (partially) copied without zip64 structures: an output that only keeps a
 * subset of the entries is never larger than its source.
 */
export function fitsRawZip(sourceSize: number, entryCount: number): boolean {
  return sourceSize < MAX_UINT32 && entryCount < MAX_UINT16;
}

let crcTable: Int32Array | undefined;
function getCrcTable(): Int32Array {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  return crcTable;
}

/** CRC-32 (IEEE) continued from `seed` (the running value, not inverted) */
export function crc32Update(seed: number, chunk: Buffer): number {
  const table = getCrcTable();
  let crc = ~seed;
  for (let i = 0; i < chunk.length; i++) {
    crc = table[(crc ^ chunk[i]) & 0xff] ^ (crc >>> 8);
  }
  return ~crc >>> 0;
}

export class RawZipWriter {
  private readonly out: fs.WriteStream;
  private readonly central: Buffer[] = [];
  private offset = 0;
  private count = 0;
  private failure: Error | null = null;
  private readonly closed: Promise<void>;

  constructor(readonly output: string) {
    this.out = fs.createWriteStream(output, { start: 0 });
    this.closed = new Promise<void>((resolve, reject) => {
      this.out.once('close', resolve);
      this.out.once('error', (error) => {
        this.failure = error;
        reject(error);
      });
    });
    // surfaced by the next write / end(), never as an unhandled rejection
    this.closed.catch(() => {});
  }

  /** Copy one entry with its file data exactly as stored in the source. */
  async addRawEntry(meta: RawZipEntry, data: Readable): Promise<void> {
    if (
      meta.compressedSize > MAX_UINT32 ||
      meta.uncompressedSize > MAX_UINT32 ||
      this.offset > MAX_UINT32 ||
      this.count >= MAX_UINT16
    ) {
      throw new Error(`zip64 required for ${meta.fileName}`);
    }
    const name = Buffer.from(meta.fileName, 'utf8');
    if (name.length > MAX_UINT16) {
      throw new Error(`file name too long: ${meta.fileName}`);
    }
    const flags =
      ((meta.generalPurposeBitFlag ?? 0) &
        FLAG_KEEP_MASK &
        ~FLAG_DATA_DESCRIPTOR) |
      FLAG_UTF8_NAMES;
    const versionNeeded = Math.max(
      VERSION_NEEDED_DEFAULT,
      meta.versionNeededToExtract ?? 0,
    );
    const localOffset = this.offset;

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(LOCAL_HEADER_SIGNATURE, 0);
    local.writeUInt16LE(versionNeeded, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(meta.compressionMethod, 8);
    local.writeUInt16LE(meta.lastModFileTime, 10);
    local.writeUInt16LE(meta.lastModFileDate, 12);
    local.writeUInt32LE(meta.crc32 >>> 0, 14);
    local.writeUInt32LE(meta.compressedSize, 18);
    local.writeUInt32LE(meta.uncompressedSize, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    await this.write(local);

    let copied = 0;
    for await (const chunk of data as AsyncIterable<Buffer>) {
      copied += chunk.length;
      await this.write(chunk);
    }
    if (copied !== meta.compressedSize) {
      throw new Error(
        `${meta.fileName}: read ${copied} bytes, expected ${meta.compressedSize}`,
      );
    }

    const header = Buffer.alloc(46 + name.length);
    header.writeUInt32LE(CENTRAL_HEADER_SIGNATURE, 0);
    header.writeUInt16LE(meta.versionMadeBy ?? VERSION_MADE_BY_UNIX, 4);
    header.writeUInt16LE(versionNeeded, 6);
    header.writeUInt16LE(flags, 8);
    header.writeUInt16LE(meta.compressionMethod, 10);
    header.writeUInt16LE(meta.lastModFileTime, 12);
    header.writeUInt16LE(meta.lastModFileDate, 14);
    header.writeUInt32LE(meta.crc32 >>> 0, 16);
    header.writeUInt32LE(meta.compressedSize, 20);
    header.writeUInt32LE(meta.uncompressedSize, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt16LE(0, 30); // extra
    header.writeUInt16LE(0, 32); // comment
    header.writeUInt16LE(0, 34); // disk number start
    header.writeUInt16LE(meta.internalFileAttributes ?? 0, 36);
    header.writeUInt32LE(
      (meta.externalFileAttributes ?? UNIX_REGULAR_FILE_ATTRIBUTES) >>> 0,
      38,
    );
    header.writeUInt32LE(localOffset, 42);
    name.copy(header, 46);
    this.central.push(header);
    this.count += 1;
  }

  /**
   * Add a local file uncompressed (its CRC is computed in a first pass).
   * `like` lends its timestamp and attributes, e.g. the archive entry this
   * file replaces.
   */
  async addStoredFile(
    filePath: string,
    fileName: string,
    like?: Pick<
      Entry,
      | 'lastModFileTime'
      | 'lastModFileDate'
      | 'externalFileAttributes'
      | 'versionMadeBy'
    >,
  ): Promise<void> {
    let crc = 0;
    let size = 0;
    for await (const chunk of fs.createReadStream(
      filePath,
    ) as AsyncIterable<Buffer>) {
      crc = crc32Update(crc, chunk);
      size += chunk.length;
    }
    await this.addRawEntry(
      {
        fileName,
        compressionMethod: 0,
        crc32: crc,
        compressedSize: size,
        uncompressedSize: size,
        lastModFileTime: like?.lastModFileTime ?? 0,
        lastModFileDate: like?.lastModFileDate ?? 0x21, // 1980-01-01
        externalFileAttributes: like?.externalFileAttributes,
        versionMadeBy: like?.versionMadeBy,
      },
      fs.createReadStream(filePath),
    );
  }

  /** Write the central directory and close the file. */
  async end(): Promise<void> {
    const cdOffset = this.offset;
    for (const header of this.central) await this.write(header);
    const cdSize = this.offset - cdOffset;
    if (cdOffset > MAX_UINT32 || cdSize > MAX_UINT32) {
      throw new Error('zip64 required for the central directory');
    }
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(EOCD_SIGNATURE, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(this.count, 8);
    eocd.writeUInt16LE(this.count, 10);
    eocd.writeUInt32LE(cdSize, 12);
    eocd.writeUInt32LE(cdOffset, 16);
    eocd.writeUInt16LE(0, 20);
    await this.write(eocd);
    this.out.end();
    await this.closed;
  }

  /** Stop writing and remove the partial output. */
  async abort(): Promise<void> {
    this.out.destroy();
    await this.closed.catch(() => {});
    await remove(this.output).catch(() => {});
  }

  private write(chunk: Buffer): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    this.offset += chunk.length;
    return new Promise((resolve, reject) => {
      this.out.write(chunk, (error) => (error ? reject(error) : resolve()));
    });
  }
}
