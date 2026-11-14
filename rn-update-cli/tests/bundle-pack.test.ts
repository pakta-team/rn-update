/**
 * [INPUT]: 依赖 packBundle、临时文件系统与 yauzl 条目读取
 * [OUTPUT]: 提供 PPK 条目、压缩策略及输出写失败的回归
 * [POS]: CLI 制品打包边界测试，验证源文件筛选与归档写入失败及时传播
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { open as openZipFile } from 'yauzl';
import { packBundle } from '../src/bundle-pack';

const hermesBytecodePrefix = Buffer.from([
  0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f,
]);
const pngPrefix = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function mkTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

type ZipEntryInfo = {
  entries: string[];
  compressionMethods: Record<string, number>;
};

async function readZipEntryInfo(zipPath: string): Promise<ZipEntryInfo> {
  const entries: string[] = [];
  const compressionMethods: Record<string, number> = {};
  await new Promise<void>((resolve, reject) => {
    openZipFile(zipPath, { lazyEntries: true }, (error, zipfile) => {
      if (error || !zipfile) {
        reject(error ?? new Error('Failed to open zip file'));
        return;
      }

      zipfile.on('entry', (entry) => {
        entries.push(entry.fileName);
        compressionMethods[entry.fileName] = entry.compressionMethod;
        zipfile.readEntry();
      });
      zipfile.once('end', () => resolve());
      zipfile.once('error', reject);

      zipfile.readEntry();
    });
  });
  return { entries, compressionMethods };
}

describe('bundle-pack', () => {
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = mkTempDir('rn-update-pack-bundle-');
  });

  afterEach(() => {
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('packs bundle and excludes ignored files', async () => {
    const sourceDir = path.join(tempRoot, 'bundle');
    const nestedDir = path.join(sourceDir, 'assets');
    fs.mkdirSync(nestedDir, { recursive: true });

    fs.writeFileSync(
      path.join(sourceDir, 'index.bundlejs'),
      Buffer.concat([hermesBytecodePrefix, Buffer.from('bundle')]),
    );
    fs.writeFileSync(path.join(sourceDir, 'index.bundlejs.map'), 'ignored-map');
    fs.writeFileSync(
      path.join(sourceDir, 'bundle.harmony.js.map'),
      'ignored-map',
    );
    fs.writeFileSync(path.join(sourceDir, 'keep.txt'), 'keep');
    fs.writeFileSync(path.join(sourceDir, 'ignored.txt.map'), 'ignored-map');
    fs.writeFileSync(path.join(sourceDir, '.DS_Store'), 'ignored');
    fs.writeFileSync(path.join(nestedDir, 'image.png'), 'image-content');
    fs.writeFileSync(path.join(nestedDir, 'bytecode.hbc'), 'hbc-content');
    fs.writeFileSync(
      path.join(nestedDir, 'image-without-extension'),
      Buffer.concat([pngPrefix, Buffer.from('image-content')]),
    );
    fs.writeFileSync(
      path.join(nestedDir, 'hermes-misnamed.png'),
      Buffer.concat([hermesBytecodePrefix, Buffer.from('bundle')]),
    );

    const outputZip = path.join(tempRoot, 'dist', 'output.ppk');
    await packBundle(sourceDir, outputZip);

    expect(fs.existsSync(outputZip)).toBe(true);

    const { entries, compressionMethods } = await readZipEntryInfo(outputZip);
    expect(entries).toContain('index.bundlejs');
    expect(entries).toContain('keep.txt');
    expect(entries).toContain('assets/');
    expect(entries).toContain('assets/image.png');
    expect(entries).toContain('assets/bytecode.hbc');
    expect(entries).toContain('assets/image-without-extension');
    expect(entries).toContain('assets/hermes-misnamed.png');

    expect(entries).not.toContain('index.bundlejs.map');
    expect(entries).not.toContain('bundle.harmony.js.map');
    expect(entries).not.toContain('ignored.txt.map');
    expect(entries).not.toContain('.DS_Store');

    expect(compressionMethods['index.bundlejs']).toBe(8);
    expect(compressionMethods['keep.txt']).toBe(8);
    expect(compressionMethods['assets/image.png']).toBe(0);
    expect(compressionMethods['assets/bytecode.hbc']).toBe(8);
    expect(compressionMethods['assets/image-without-extension']).toBe(0);
    expect(compressionMethods['assets/hermes-misnamed.png']).toBe(8);
  });

  test('rejects instead of hanging when the output cannot be written', async () => {
    const sourceDir = path.join(tempRoot, 'bundle');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'index.bundlejs'), 'bundle');
    const output = path.join(tempRoot, 'out.ppk');
    fs.mkdirSync(output);

    await expect(packBundle(sourceDir, output)).rejects.toMatchObject({
      code: 'EISDIR',
    });
    expect(fs.statSync(output).isDirectory()).toBe(true);
  });

  test('excludes sourcemap derived from a custom bundleName', async () => {
    const sourceDir = path.join(tempRoot, 'bundle');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'custom.bundle'), 'bundle');
    fs.writeFileSync(path.join(sourceDir, 'custom.bundle.map'), 'map');

    const withName = path.join(tempRoot, 'with-name.ppk');
    await packBundle(sourceDir, withName, 'custom.bundle');
    const withNameInfo = await readZipEntryInfo(withName);
    expect(withNameInfo.entries).toContain('custom.bundle');
    expect(withNameInfo.entries).not.toContain('custom.bundle.map');

    // without bundleName the custom map is not excluded
    const withoutName = path.join(tempRoot, 'without-name.ppk');
    await packBundle(sourceDir, withoutName);
    expect((await readZipEntryInfo(withoutName)).entries).toContain(
      'custom.bundle.map',
    );
  });
});
