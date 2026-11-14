/**
 * [INPUT]: 依赖文件系统、路径、文件前缀魔数与 ZIP 压缩等级约定
 * [OUTPUT]: 对外提供 ZipEntryOptions、压缩阈值常量及条目压缩策略函数
 * [POS]: CLI 归档压缩策略层，按 payload 类型选择安全且可复现的 ZIP 参数
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import * as fs from 'fs';
import path from 'path';
import { HBC_MAGIC } from './hbcTransform';

export type ZipEntryOptions = {
  compress?: boolean;
  compressionLevel?: number;
};

export const ZIP_ENTRY_SNIFF_BYTES = 64;
export const MANIFEST_COMPRESSION_THRESHOLD_BYTES = 256;
// Deflate level for the bundle/asset payload. Level 9 measured ~4x the CPU
// of level 6 on Hermes bytecode for ~0.6% smaller output, so 6 is the sweet
// spot; the manifest is tiny, so it can afford 9.
export const PAYLOAD_COMPRESSION_LEVEL = 6;
export const MANIFEST_COMPRESSION_LEVEL = 9;

const alreadyCompressedExtensions = new Set([
  '.7z',
  '.aab',
  '.apk',
  '.br',
  '.bz2',
  '.gif',
  '.gz',
  '.heic',
  '.jpeg',
  '.jpg',
  '.lzma',
  '.mp3',
  '.mp4',
  '.ogg',
  '.png',
  '.webm',
  '.webp',
  '.woff',
  '.woff2',
  '.xz',
  '.zip',
  '.zst',
]);

const HERMES_DELTA_MAGIC = Buffer.from([
  0x39, 0xe0, 0x43, 0xfc, 0x3e, 0xfc, 0xe6, 0xe0,
]);

function startsWith(bytes: Buffer, signature: Buffer): boolean {
  return (
    bytes.length >= signature.length &&
    bytes.subarray(0, signature.length).equals(signature)
  );
}

function hasHermesBytecodeMagic(bytes: Buffer): boolean {
  return startsWith(bytes, HBC_MAGIC) || startsWith(bytes, HERMES_DELTA_MAGIC);
}

/** leading bytes of formats that are already compressed */
const COMPRESSED_MAGIC = [
  [0x89, 0x50, 0x4e, 0x47], // PNG
  [0xff, 0xd8, 0xff], // JPEG
  'GIF87a',
  'GIF89a',
  [0x50, 0x4b, 0x03, 0x04], // zip
  [0x50, 0x4b, 0x05, 0x06], // empty zip
  [0x50, 0x4b, 0x07, 0x08], // spanned zip
  [0x1f, 0x8b], // gzip
  'BZh',
  [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00], // xz
  [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], // 7z
  [0x28, 0xb5, 0x2f, 0xfd], // zstd
  'OggS',
  'ID3', // mp3 with tags
  'wOFF',
  'wOF2',
].map((magic) => Buffer.from(magic as string));

function hasAlreadyCompressedMagic(bytes: Buffer): boolean {
  if (bytes.length < 2) {
    return false;
  }
  const at = (offset: number, ascii: string) =>
    bytes.subarray(offset, offset + ascii.length).equals(Buffer.from(ascii));
  return (
    COMPRESSED_MAGIC.some((magic) => startsWith(bytes, magic)) ||
    // WebP: RIFF container with a WEBP form type
    (bytes.length >= 12 && at(0, 'RIFF') && at(8, 'WEBP')) ||
    // ISO base media (mp4, m4a, heic, avif...)
    (bytes.length >= 12 && at(4, 'ftyp')) ||
    // MPEG audio frame sync
    (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
  );
}

function readFilePrefix(filePath: string): Buffer {
  const buffer = Buffer.alloc(ZIP_ENTRY_SNIFF_BYTES);
  const fd = fs.openSync(filePath, 'r');
  try {
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}

export function zipOptionsForPatchEntry(): ZipEntryOptions {
  return { compress: false };
}

export function zipOptionsForManifestEntry(byteLength = 0): ZipEntryOptions {
  if (byteLength >= MANIFEST_COMPRESSION_THRESHOLD_BYTES) {
    return { compressionLevel: MANIFEST_COMPRESSION_LEVEL };
  }
  return { compress: false };
}

export function zipOptionsForPayloadEntry(
  fileName: string,
  prefix?: Buffer,
): ZipEntryOptions {
  if (prefix && prefix.length > 0) {
    if (hasHermesBytecodeMagic(prefix)) {
      // Hermes bytecode is binary, but still benefits significantly from zip deflate.
      return { compress: true, compressionLevel: PAYLOAD_COMPRESSION_LEVEL };
    }
    if (hasAlreadyCompressedMagic(prefix)) {
      return { compress: false };
    }
  }

  const extension = path.extname(fileName).toLowerCase();
  if (alreadyCompressedExtensions.has(extension)) {
    return { compress: false };
  }
  return { compress: true, compressionLevel: PAYLOAD_COMPRESSION_LEVEL };
}

export function zipOptionsForPayloadFile(
  filePath: string,
  entryName = filePath,
): ZipEntryOptions {
  return zipOptionsForPayloadEntry(entryName, readFilePrefix(filePath));
}
