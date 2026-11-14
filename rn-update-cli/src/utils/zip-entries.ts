/**
 * [INPUT]: 依赖 node:fs、fs-helpers 的目录创建/清理、临时目录、路径、流式管道与 ZIP 条目元数据
 * [OUTPUT]: 对外提供 ZIP 条目读取、写入、前缀读取和枚举能力
 * [POS]: CLI 归档基础设施，统一 ZIP 资源生命周期；落盘显式维护偏移，避免 WSL 挂载盘混合 write/writev 覆盖首块
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import {
  type Entry,
  open as openZipFile,
  type ZipFile as YauzlZipFile,
} from 'yauzl';
import { ZipFile as YazlZipFile } from 'yazl';
import { ensureDirSync, remove } from './fs-helpers';

export function openEntryStream(
  entry: Entry,
  zipFile: YauzlZipFile,
  options: { decodeFileData?: boolean } = {},
): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, options, (err, stream) => {
      if (err || !stream) {
        reject(err ?? new Error(`Unable to read zip entry: ${entry.fileName}`));
        return;
      }
      resolve(stream);
    });
  });
}

export async function readEntry(
  entry: Entry,
  zipFile: YauzlZipFile,
): Promise<Buffer> {
  const buffers: Buffer[] = [];
  for await (const chunk of await openEntryStream(entry, zipFile)) {
    buffers.push(chunk);
  }
  // a single chunk (a cached Range read) is handed back as-is, not copied
  return buffers.length === 1 ? buffers[0] : Buffer.concat(buffers);
}

export async function writeEntry(
  entry: Entry,
  zipFile: YauzlZipFile,
  outputPath: string,
): Promise<void> {
  ensureDirSync(path.dirname(outputPath));
  await pipeline(
    await openEntryStream(entry, zipFile),
    fs.createWriteStream(outputPath, { start: 0 }),
  );
}

export async function readEntryPrefix(
  entry: Entry,
  zipFile: YauzlZipFile,
  maxBytes: number,
): Promise<Buffer> {
  if (maxBytes <= 0) {
    return Buffer.alloc(0);
  }
  const buffers: Buffer[] = [];
  let length = 0;
  // leaving the loop early destroys the stream without an error
  for await (const chunk of await openEntryStream(entry, zipFile)) {
    const slice = chunk.subarray(0, maxBytes - length);
    buffers.push(slice);
    length += slice.length;
    if (length >= maxBytes) {
      break;
    }
  }
  return Buffer.concat(buffers, length);
}

/** Open a local zip and stop at the first matching entry (caller closes). */
export function openFirstEntry(
  zipPath: string,
  matches: (name: string) => boolean,
): Promise<{ zipFile: YauzlZipFile; entry: Entry } | null> {
  return new Promise((resolve, reject) => {
    openZipFile(
      zipPath,
      { lazyEntries: true, autoClose: false },
      (err, zipFile) => {
        if (err) return reject(err);
        let settled = false;
        zipFile.on('error', (error) => {
          if (!settled) {
            settled = true;
            reject(error);
          }
        });
        zipFile.on('end', () => {
          if (!settled) {
            settled = true;
            zipFile.close();
            resolve(null);
          }
        });
        zipFile.on('entry', (entry: Entry) => {
          if (settled) return;
          if (matches(entry.fileName)) {
            settled = true;
            resolve({ zipFile, entry });
            return;
          }
          zipFile.readEntry();
        });
        zipFile.readEntry();
      },
    );
  });
}

/** Content of the first matching entry of a local zip, or null. */
export async function readFirstEntry(
  zipPath: string,
  matches: (name: string) => boolean,
): Promise<Buffer | null> {
  const found = await openFirstEntry(zipPath, matches);
  if (!found) return null;
  try {
    return await readEntry(found.entry, found.zipFile);
  } finally {
    found.zipFile.close();
  }
}

/** Extract the first matching entry of a local zip to `outputPath`. */
export async function extractFirstEntry(
  zipPath: string,
  matches: (name: string) => boolean,
  outputPath: string,
): Promise<boolean> {
  const found = await openFirstEntry(zipPath, matches);
  if (!found) return false;
  try {
    await writeEntry(found.entry, found.zipFile, outputPath);
  } finally {
    found.zipFile.close();
  }
  return true;
}

/**
 * A yazl archive piped into `output`. `writePromise` settles once the file is
 * closed; `abort` releases the fd and deletes the partial file.
 */
export function createOutputZip(output: string) {
  ensureDirSync(path.dirname(output));
  const zipfile = new YazlZipFile();
  const writeStream = fs.createWriteStream(output, { start: 0 });
  const writePromise = new Promise<void>((resolve, reject) => {
    zipfile.outputStream.on('error', reject);
    // without this, a full disk / read-only target left the promise pending
    writeStream.on('error', reject);
    zipfile.outputStream.pipe(writeStream).on('close', () => {
      resolve(void 0);
    });
  });
  // a write error can come while the caller is still building entries, long
  // before it awaits writePromise: mark it handled now (awaiting the original
  // promise still rejects) so it never surfaces as an unhandled rejection
  writePromise.catch(() => {});
  // 失败时释放输出 fd 并删掉半成品,避免残留一个截断的包
  const abort = async () => {
    zipfile.outputStream.unpipe(writeStream);
    // yazl 的 outputStream 类型声明缺 destroy,运行时是 PassThrough
    (zipfile.outputStream as unknown as { destroy(): void }).destroy();
    if (!writeStream.closed) {
      // 等 fd 真正关闭再删文件,避免 Windows 上删除被占用文件失败
      await new Promise<void>((resolve) => {
        writeStream.once('close', () => resolve());
        if (!writeStream.destroyed) {
          writeStream.destroy();
        }
      });
    }
    // best effort: a failed cleanup must not mask the original error
    await fs.promises.rm(output, { force: true }).catch(() => {});
  };
  return { zipfile, writePromise, abort };
}

export async function enumZipEntries(
  zipFn: string,
  callback: (
    entry: Entry,
    zipFile: YauzlZipFile,
    nestedPath?: string,
  ) => Promise<any> | undefined,
  nestedPath = '',
) {
  return new Promise((resolve, reject) => {
    openZipFile(zipFn, { lazyEntries: true }, (err: any, zipfile) => {
      if (err) {
        return reject(err);
      }

      zipfile.on('end', resolve);
      zipfile.on('error', reject);
      zipfile.on('entry', async (entry) => {
        const fullPath = nestedPath + entry.fileName;

        try {
          if (
            !entry.fileName.endsWith('/') &&
            entry.fileName.toLowerCase().endsWith('.hap')
          ) {
            const tempDir = await fs.promises.mkdtemp(
              path.join(os.tmpdir(), 'nested_zip_'),
            );
            const tempZipPath = path.join(tempDir, 'temp.zip');
            try {
              await writeEntry(entry, zipfile, tempZipPath);
              await enumZipEntries(tempZipPath, callback, `${fullPath}/`);
            } finally {
              await remove(tempDir);
            }
          }

          await callback(entry, zipfile, fullPath);
        } catch (error) {
          // the rejection carries the error; logging it here too would make
          // callers report it twice
          zipfile.close();
          reject(error);
          return;
        }

        zipfile.readEntry();
      });

      zipfile.readEntry();
    });
  });
}
