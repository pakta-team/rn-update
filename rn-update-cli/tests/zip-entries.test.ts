/**
 * [INPUT]: 依赖 ZIP 枚举/输出工厂、临时文件系统与 yazl 夹具
 * [OUTPUT]: 提供嵌套 HAP 清理和归档早期写失败回归
 * [POS]: CLI ZIP 公共基础设施测试，约束异步错误传播及部分制品资源释放
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { ZipFile } from 'yazl';
import { createOutputZip, enumZipEntries } from '../src/utils/zip-entries';

function zipBuffer(entries: Record<string, Buffer>): Promise<Buffer> {
  const zip = new ZipFile();
  for (const [name, data] of Object.entries(entries)) {
    zip.addBuffer(data, name);
  }
  zip.end();
  const parts: Buffer[] = [];
  return new Promise((resolve, reject) => {
    zip.outputStream
      .on('data', (part: Buffer) => parts.push(part))
      .on('end', () => resolve(Buffer.concat(parts)))
      .on('error', reject);
  });
}

describe('createOutputZip', () => {
  test('a write error before writePromise is awaited is not an unhandled rejection', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rnu-output-zip-'));
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const output = path.join(dir, 'out.ppk');
      fs.mkdirSync(output);
      const { writePromise, abort } = createOutputZip(output);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(unhandled).toEqual([]);
      await expect(writePromise).rejects.toMatchObject({ code: 'EISDIR' });
      await abort();
      expect(fs.statSync(output).isDirectory()).toBe(true);
    } finally {
      process.off('unhandledRejection', onUnhandled);
      fs.removeSync(dir);
    }
  });
});

const nestedTempDirs = () =>
  fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('nested_zip_'));

describe('enumZipEntries', () => {
  let dir: string;
  let app: string;
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rnu-zip-entries-'));
    app = path.join(dir, 'harmony.app');
    const hap = await zipBuffer({
      'resources/rawfile/bundle.harmony.js': Buffer.from('bundle'),
    });
    fs.writeFileSync(
      app,
      await zipBuffer({ 'entry.hap': hap, 'pack.info': Buffer.from('{}') }),
    );
  });
  afterEach(() => {
    fs.removeSync(dir);
  });

  test('walks into a nested .hap and cleans up its temp dir', async () => {
    const before = nestedTempDirs();
    const seen: string[] = [];
    await enumZipEntries(app, (_entry, _zip, nestedPath) => {
      seen.push(nestedPath ?? '');
      return undefined;
    });
    expect(seen).toEqual([
      'entry.hap/resources/rawfile/bundle.harmony.js',
      'entry.hap',
      'pack.info',
    ]);
    expect(nestedTempDirs()).toEqual(before);
  });

  test('a failing callback rejects once, without logging, and still cleans up', async () => {
    const before = nestedTempDirs();
    const originalError = console.error;
    const logged: unknown[] = [];
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };
    try {
      const failure = new Error('boom');
      const error = await enumZipEntries(app, (_entry, _zip, nestedPath) => {
        if (nestedPath?.includes('/')) throw failure;
        return undefined;
      }).then(
        () => null,
        (e) => e,
      );
      expect(error).toBe(failure);
    } finally {
      console.error = originalError;
    }
    expect(logged).toEqual([]);
    expect(nestedTempDirs()).toEqual(before);
  });
});
