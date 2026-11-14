/**
 * [INPUT]: 依赖 APK/IPA/Harmony 原生归档、平台保留规则与底层 ZIP 写入器
 * [OUTPUT]: 对外提供原生包差分条目解析及上传前的精简归档生成
 * [POS]: CLI 原生制品预处理层，只保留热更新基线所需的 JS bundle 与资源，供 package 登记和 pdiff 使用
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { promisify } from 'util';
import {
  type Entry,
  open as openZipFile,
  type ZipFile as YauzlZipFile,
} from 'yauzl';
import zlib from 'zlib';
import type { Platform } from './types';
import { ensureDir, remove } from './utils/fs-helpers';
import {
  createOutputZip,
  openEntryStream,
  readEntry,
  writeEntry,
} from './utils/zip-entries';
import { fitsRawZip, RawZipWriter } from './utils/zip-raw-writer';

export type NativePackageEntry = {
  diffPath: string;
  kind: 'bundle' | 'resource';
};

type NativePackageRule = {
  resolveEntry: (entryName: string) => NativePackageEntry | undefined;
};

const nativePackageRules: Record<Platform, NativePackageRule> = {
  android: {
    resolveEntry: (entryName) => {
      if (entryName === 'assets/index.android.bundle') {
        return { diffPath: entryName, kind: 'bundle' };
      }
      if (entryName.startsWith('assets/') || entryName.startsWith('res/')) {
        return { diffPath: entryName, kind: 'resource' };
      }
    },
  },
  ios: {
    resolveEntry: (entryName) => {
      const match = /^Payload\/[^/]+\.app\/(.+)$/.exec(entryName);
      const appPath = match?.[1];
      if (appPath === 'main.jsbundle') {
        return { diffPath: appPath, kind: 'bundle' };
      }
      if (appPath?.startsWith('assets/')) {
        return { diffPath: appPath, kind: 'resource' };
      }
    },
  },
  harmony: {
    resolveEntry: (entryName) => {
      if (entryName === 'resources/rawfile/bundle.harmony.js') {
        return { diffPath: entryName, kind: 'bundle' };
      }
      if (entryName.startsWith('resources/rawfile/assets/')) {
        return { diffPath: entryName, kind: 'resource' };
      }
    },
  },
};

/**
 * Resolve an archive entry that can be used as a native-package diff origin.
 * Upload extraction and diff indexing deliberately share this function so a
 * file cannot be removed from the uploaded baseline while still being
 * considered by the local diff implementation (or vice versa).
 */
export function resolveNativePackageEntry(
  platform: Platform,
  entryName: string,
): NativePackageEntry | undefined {
  return nativePackageRules[platform].resolveEntry(entryName);
}

/**
 * Entries kept for the server only: it maps resource names to their (shortened)
 * paths through resources.arsc when building a package diff. They are never a
 * diff origin, so they stay out of resolveNativePackageEntry.
 */
const serverOnlyEntries: Partial<Record<Platform, string>> = {
  android: 'resources.arsc',
};

const deflateRaw = promisify(zlib.deflateRaw);

/** Where the kept entries go: a raw copy (default) or a yazl repack. */
interface SlimSink {
  copyEntry(sourceZip: YauzlZipFile, entry: Entry): Promise<void>;
  /** like copyEntry, but an entry the source stores uncompressed is deflated */
  copyEntryDeflated(sourceZip: YauzlZipFile, entry: Entry): Promise<void>;
  /** add a local file under `fileName`, dated like `like` */
  addFile(filePath: string, fileName: string, like: Entry): Promise<void>;
  end(): Promise<void>;
  abort(): Promise<void>;
}

/**
 * Copies each entry's stored bytes, CRC and sizes verbatim (yauzl hands out
 * the raw file data with `decodeFileData: false`), so slimming a package is
 * bound by disk I/O rather than by deflating every asset again.
 */
class RawCopySink implements SlimSink {
  private readonly writer: RawZipWriter;
  constructor(output: string) {
    this.writer = new RawZipWriter(output);
  }
  async copyEntry(sourceZip: YauzlZipFile, entry: Entry): Promise<void> {
    const readStream = await openEntryStream(entry, sourceZip, {
      decodeFileData: false,
    });
    await this.writer.addRawEntry(entry, readStream);
  }
  async copyEntryDeflated(
    sourceZip: YauzlZipFile,
    entry: Entry,
  ): Promise<void> {
    if (entry.compressionMethod !== 0) {
      return this.copyEntry(sourceZip, entry);
    }
    const deflated = await deflateRaw(await readEntry(entry, sourceZip), {
      level: zlib.constants.Z_BEST_COMPRESSION,
    });
    await this.writer.addRawEntry(
      {
        ...entry,
        compressionMethod: 8,
        compressedSize: deflated.length,
        // deflate strength bits of a stored entry mean nothing
        generalPurposeBitFlag: 0,
      },
      Readable.from([deflated]),
    );
  }
  addFile(filePath: string, fileName: string, like: Entry): Promise<void> {
    // a nested slim archive is a zip of deflated entries: storing it as-is
    // loses nothing and skips another pass over its bytes
    return this.writer.addStoredFile(filePath, fileName, like);
  }
  end(): Promise<void> {
    return this.writer.end();
  }
  abort(): Promise<void> {
    return this.writer.abort();
  }
}

/** Re-deflates every kept entry through yazl; only for sources that need zip64. */
class RepackSink implements SlimSink {
  private readonly output: ReturnType<typeof createOutputZip>;
  constructor(output: string) {
    this.output = createOutputZip(output);
  }
  copyEntry(sourceZip: YauzlZipFile, entry: Entry): Promise<void> {
    return this.add(sourceZip, entry, entry.compressionMethod !== 0);
  }
  copyEntryDeflated(sourceZip: YauzlZipFile, entry: Entry): Promise<void> {
    return this.add(sourceZip, entry, true);
  }
  private async add(
    sourceZip: YauzlZipFile,
    entry: Entry,
    compress: boolean,
  ): Promise<void> {
    const readStream = await openEntryStream(entry, sourceZip);
    await new Promise<void>((resolve, reject) => {
      readStream.once('error', reject);
      readStream.once('end', () => resolve());
      this.output.zipfile.addReadStream(readStream, entry.fileName, {
        compress,
        mtime: entry.getLastModDate(),
      });
    });
  }
  async addFile(
    filePath: string,
    fileName: string,
    like: Entry,
  ): Promise<void> {
    this.output.zipfile.addFile(filePath, fileName, {
      compress: like.compressionMethod !== 0,
      mtime: like.getLastModDate(),
    });
  }
  async end(): Promise<void> {
    this.output.zipfile.end();
    await this.output.writePromise;
  }
  abort(): Promise<void> {
    return this.output.abort();
  }
}

function openZip(source: string): Promise<YauzlZipFile> {
  return new Promise((resolve, reject) => {
    openZipFile(source, { lazyEntries: true }, (error, zipFile) => {
      if (error || !zipFile) {
        reject(error ?? new Error(`Unable to open zip file: ${source}`));
        return;
      }
      resolve(zipFile);
    });
  });
}

export interface SlimPackageOptions {
  /** re-deflate through yazl even when a raw copy would do (tests) */
  repack?: boolean;
}

async function filterNativePackageArchive(
  source: string,
  output: string,
  platform: Platform,
  options: SlimPackageOptions,
): Promise<{ bundles: number; entries: number }> {
  await ensureDir(path.dirname(output));
  const scratchDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'rnu-native-package-entry-'),
  );
  const sourceZip = await openZip(source);
  // a subset of the source never outgrows it, so the source's own size and
  // entry count decide whether plain (non-zip64) headers are enough
  const rawCopy =
    !options.repack &&
    fitsRawZip((await fs.promises.stat(source)).size, sourceZip.entryCount);
  const sink: SlimSink = rawCopy
    ? new RawCopySink(output)
    : new RepackSink(output);
  let includedEntries = 0;
  let includedBundles = 0;
  let nestedArchiveIndex = 0;

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (error: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        sourceZip.close();
        reject(error);
      };

      sourceZip.once('error', fail);
      sourceZip.once('end', () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      });
      sourceZip.on('entry', async (entry) => {
        try {
          if (entry.fileName.endsWith('/')) {
            sourceZip.readEntry();
            return;
          }

          // Harmony .app packages contain one or more nested .hap archives.
          // Rebuild those archives recursively and keep their outer path so
          // the slim package has the same nesting as the original package.
          if (
            platform === 'harmony' &&
            entry.fileName.toLowerCase().endsWith('.hap')
          ) {
            const index = nestedArchiveIndex++;
            const nestedSource = path.join(scratchDir, `${index}.source.hap`);
            const nestedOutput = path.join(scratchDir, `${index}.slim.hap`);
            await writeEntry(entry, sourceZip, nestedSource);
            const nestedResult = await filterNativePackageArchive(
              nestedSource,
              nestedOutput,
              platform,
              options,
            );
            if (nestedResult.entries > 0) {
              await sink.addFile(nestedOutput, entry.fileName, entry);
              includedEntries += nestedResult.entries;
              includedBundles += nestedResult.bundles;
            }
            sourceZip.readEntry();
            return;
          }

          const resolvedEntry = resolveNativePackageEntry(
            platform,
            entry.fileName,
          );
          if (resolvedEntry) {
            await sink.copyEntry(sourceZip, entry);
            includedEntries += 1;
            if (resolvedEntry.kind === 'bundle') {
              includedBundles += 1;
            }
          } else if (entry.fileName === serverOnlyEntries[platform]) {
            await sink.copyEntryDeflated(sourceZip, entry);
            includedEntries += 1;
          }
          sourceZip.readEntry();
        } catch (error) {
          fail(error);
        }
      });

      sourceZip.readEntry();
    });

    await sink.end();
    return { bundles: includedBundles, entries: includedEntries };
  } catch (error) {
    await sink.abort();
    throw error;
  } finally {
    await remove(scratchDir);
  }
}

/**
 * Repack a native package with only the bundle and resources required by
 * package-origin diffs, plus the server-only entries. Entry names and nested Harmony HAP structure are kept.
 */
export async function createSlimNativePackage(
  source: string,
  output: string,
  platform: Platform,
  options: SlimPackageOptions = {},
): Promise<void> {
  const result = await filterNativePackageArchive(
    source,
    output,
    platform,
    options,
  );
  if (result.bundles === 0) {
    await remove(output);
    throw new Error(`Bundle entry not found in native package: ${source}`);
  }
}
