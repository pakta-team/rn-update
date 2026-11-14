/**
 * [INPUT]: 依赖 node-stream-zip 流式解压、Node 定位读取及 scripts/contract.json 的现有归档预算
 * [OUTPUT]: 提供 verifyArtifactSet、verifyArtifactSetSync，拒绝损坏 full/patch 与非法差分清单
 * [POS]: e2etest 制品只读门卫，生成和复用共用同一检查，不解包、不持有平台或设备状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const LIMITS = require('../../../scripts/contract.json').archiveLimits;
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value;
});
function crcUpdate(crc, chunk) {
  for (const byte of chunk) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return crc;
}
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function assertManifest(bytes, kind) {
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('Invalid __diff.json JSON');
  }
  const map = (item, validate) =>
    record(item) && Object.values(item).every(validate);
  if (
    !record(value) ||
    !map(value.copies, (item) => typeof item === 'string') ||
    (kind === 'ppkPatch' && !map(value.deletes, (item) => item === 1)) ||
    (value.deletes !== undefined &&
      !map(value.deletes, (item) => item === 1)) ||
    (value.copiesCrc !== undefined &&
      !map(
        value.copiesCrc,
        (item) => Number.isInteger(item) && item >= 0 && item <= 0xffffffff
      )) ||
    (value.hbcTransform !== undefined && !record(value.hbcTransform))
  )
    throw new Error('Invalid __diff.json manifest shape');
}
function read(fd, length, position) {
  const buffer = Buffer.alloc(length);
  if (fs.readSync(fd, buffer, 0, length, position) !== length)
    throw new Error('Truncated ZIP header');
  return buffer;
}
function localHeader(fd, entry, end) {
  const header = read(fd, 30, entry.offset);
  const nameLength = header.readUInt16LE(26);
  const extraLength = header.readUInt16LE(28);
  if (
    header.readUInt32LE(0) !== 0x04034b50 ||
    header.readUInt16LE(6) !== entry.flags ||
    header.readUInt16LE(8) !== entry.method ||
    !read(fd, nameLength, entry.offset + 30).equals(Buffer.from(entry.name))
  )
    throw new Error('ZIP local header differs from central directory');
  const dataEnd =
    entry.offset + 30 + nameLength + extraLength + entry.compressedSize;
  if (!Number.isSafeInteger(dataEnd) || dataEnd > end)
    throw new Error('ZIP entry overlaps the next header or central directory');
  const expected = [entry.crc, entry.compressedSize, entry.size];
  const actual = [
    header.readUInt32LE(14),
    header.readUInt32LE(18),
    header.readUInt32LE(22),
  ];
  if (entry.flags & 8) {
    if (actual.some((item, index) => item !== 0 && item !== expected[index]))
      throw new Error('ZIP local sizes differ from central directory');
    const signature = read(fd, 4, dataEnd).readUInt32LE(0);
    const descriptor = read(
      fd,
      12,
      dataEnd + (signature === 0x08074b50 ? 4 : 0)
    );
    if (
      expected.some(
        (item, index) => descriptor.readUInt32LE(index * 4) !== item
      ) ||
      dataEnd + 12 + (signature === 0x08074b50 ? 4 : 0) !== end
    )
      throw new Error('ZIP data descriptor differs from central directory');
  } else if (
    actual.some((item, index) => item !== expected[index]) ||
    dataEnd !== end
  ) {
    throw new Error('ZIP local sizes or offsets differ from central directory');
  }
}
async function verifyZip(file, platform, kind) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size === 0)
    throw new Error('ZIP must be a nonempty file');
  if (stat.size > LIMITS.MaxArchiveBytes)
    throw new Error('ZIP archive budget exceeded');
  const StreamZip = require('node-stream-zip');
  const zip = new StreamZip({ file, storeEntries: true });
  const entries = [];
  let declaredTotal = 0;
  zip.on('entry', (entry) => {
    declaredTotal += entry.size;
    if (
      entries.length >= LIMITS.MaxEntries ||
      entry.size > LIMITS.MaxEntryBytes ||
      declaredTotal > LIMITS.MaxTotalUncompressedBytes ||
      (entry.size >= LIMITS.RatioCheckMinBytes &&
        entry.size >
          Math.max(1, entry.compressedSize) * LIMITS.MaxCompressionRatio)
    )
      throw new Error('ZIP entry, total, count or compression budget exceeded');
    entries.push({ ...entry, isFile: entry.isFile });
  });
  const fd = fs.openSync(file, 'r');
  try {
    await new Promise((resolve, reject) => {
      zip.once('ready', resolve);
      zip.on('error', reject);
    });
    const directory = zip.centralDirectory;
    if (
      !entries.length ||
      entries.length !== directory.totalEntries ||
      directory.totalEntries !== directory.volumeEntries ||
      directory.offset + directory.size !== directory.headerOffset ||
      directory.headerOffset + 22 + directory.commentLength !== stat.size
    )
      throw new Error('Invalid ZIP central directory bounds');
    let centralCursor = directory.offset;
    for (const entry of entries) {
      if (entry.headerOffset !== centralCursor)
        throw new Error('ZIP central directory entries are not contiguous');
      centralCursor += 46 + entry.fnameLen + entry.extraLen + entry.comLen;
    }
    if (centralCursor !== directory.offset + directory.size)
      throw new Error('ZIP central directory size mismatch');
    const names = new Set();
    entries.sort((left, right) => left.offset - right.offset);
    if (entries[0].offset !== 0)
      throw new Error('ZIP first local header must start at zero');
    let manifest;
    let streamedTotal = 0;
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      const key = entry.name.toLowerCase();
      if (
        names.has(key) ||
        !entry.name ||
        /[\\\x00-\x1f]/.test(entry.name) ||
        entry.name.startsWith('/') ||
        entry.name.split('/').includes('..')
      )
        throw new Error('Duplicate or unsafe ZIP entry');
      names.add(key);
      if (
        ![entry.offset, entry.size, entry.compressedSize].every(
          (item) => Number.isSafeInteger(item) && item >= 0 && item < 0xffffffff
        ) ||
        entry.flags & 1 ||
        ![0, 8].includes(entry.method)
      )
        throw new Error('Unsupported ZIP fixture metadata');
      const end = entries[index + 1]?.offset ?? directory.offset;
      localHeader(fd, entry, end);
      if (!entry.isFile) {
        if (entry.size || entry.compressedSize || entry.crc)
          throw new Error('Invalid ZIP directory payload');
        continue;
      }
      let size = 0;
      let crc = -1;
      const chunks = [];
      const stream = await new Promise((resolve, reject) =>
        zip.stream(entry.name, (error, value) =>
          error ? reject(error) : resolve(value)
        )
      );
      for await (const chunk of stream) {
        size += chunk.length;
        streamedTotal += chunk.length;
        if (
          size > entry.size ||
          size > LIMITS.MaxEntryBytes ||
          streamedTotal > LIMITS.MaxTotalUncompressedBytes
        )
          throw new Error(
            'ZIP uncompressed size exceeds central directory or budget'
          );
        crc = crcUpdate(crc, chunk);
        if (entry.name === '__diff.json') {
          if (size > LIMITS.MaxManifestBytes)
            throw new Error('__diff.json budget exceeded');
          chunks.push(chunk);
        }
      }
      if (size !== entry.size || (crc ^ -1) >>> 0 !== entry.crc)
        throw new Error('ZIP size or CRC mismatch');
      if (entry.name === '__diff.json') manifest = Buffer.concat(chunks);
    }
    const bundle =
      platform === 'harmony' ? 'bundle.harmony.js' : 'index.bundlejs';
    const required = kind === 'full' ? bundle : `${bundle}.patch`;
    if (
      !entries.some(
        (entry) => entry.name === required && entry.isFile && entry.size > 0
      )
    )
      throw new Error(`ZIP required nonempty entry missing: ${required}`);
    if (kind !== 'full') {
      if (!manifest) throw new Error('ZIP required entry missing: __diff.json');
      assertManifest(manifest, kind);
    }
    return {
      file: path.basename(file),
      entries: entries.length,
      crcVerified: true,
    };
  } finally {
    fs.closeSync(fd);
    await new Promise((resolve) => zip.close(resolve));
  }
}
async function verifyArtifactSet(directory, platform, real = true) {
  if (!['harmony', 'android'].includes(platform))
    throw new Error('Invalid artifact platform');
  const full =
    platform === 'harmony'
      ? ['v1.ppk', 'v2.ppk', 'v4.ppk']
      : ['v1.ppk', 'v2.ppk', 'v3.ppk', 'v4.ppk'];
  const files = full.map((file) => [file, 'full']);
  if (real)
    files.push(
      ['v1-to-v2.ppk.patch', 'ppkPatch'],
      ['to-v4.v2track.ppk.patch', 'ppkPatch']
    );
  if (real && platform === 'android')
    files.push(['base-to-v3.apk.patch', 'packagePatch']);
  const results = [];
  for (const [file, kind] of files)
    results.push(await verifyZip(path.join(directory, file), platform, kind));
  return results;
}
function verifyArtifactSetSync(directory, platform, real = true) {
  const result = spawnSync(
    process.execPath,
    [__filename, directory, platform, real ? 'real' : 'full'],
    { encoding: 'utf8', timeout: 180000, maxBuffer: 512 * 1024 }
  );
  if (result.error || result.status !== 0)
    throw new Error(
      `Invalid ZIP artifacts: ${result.error?.message || result.stderr.trim()}`
    );
  return JSON.parse(result.stdout);
}
if (require.main === module) {
  const [directory, platform, mode] = process.argv.slice(2);
  verifyArtifactSet(directory, platform, mode !== 'full').then(
    (result) => console.log(JSON.stringify(result)),
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    }
  );
}
module.exports = { verifyArtifactSet, verifyArtifactSetSync, verifyZip };
