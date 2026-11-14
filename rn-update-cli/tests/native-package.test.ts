import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ZipFile as YazlZipFile } from 'yazl';
import {
  createSlimNativePackage,
  resolveNativePackageEntry,
} from '../src/native-package';
import { enumZipEntries, readEntry } from '../src/utils/zip-entries';

async function createZip(
  output: string,
  entries: Record<string, string | Buffer>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const zipFile = new YazlZipFile();
    zipFile.outputStream.once('error', reject);
    zipFile.outputStream
      .pipe(fs.createWriteStream(output))
      .once('error', reject)
      .once('close', () => resolve());

    for (const [entryName, value] of Object.entries(entries)) {
      zipFile.addBuffer(
        Buffer.isBuffer(value) ? value : Buffer.from(value),
        entryName,
      );
    }
    zipFile.end();
  });
}

async function readZipFiles(filePath: string): Promise<Record<string, Buffer>> {
  const files: Record<string, Buffer> = {};
  await enumZipEntries(filePath, async (entry, zipFile, nestedPath) => {
    if (!entry.fileName.endsWith('/')) {
      files[nestedPath || entry.fileName] = await readEntry(entry, zipFile);
    }
  });
  return files;
}

describe('native package baseline extraction', () => {
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rnu-native-package-'));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('uses one resolver for diff paths and extraction eligibility', () => {
    expect(
      resolveNativePackageEntry(
        'ios',
        'Payload/Test.app/assets/images/icon.png',
      ),
    ).toEqual({
      diffPath: 'assets/images/icon.png',
      kind: 'resource',
    });
    expect(
      resolveNativePackageEntry('ios', 'Payload/Test.app/Frameworks/RN'),
    ).toBeUndefined();
    expect(
      resolveNativePackageEntry('android', 'assets/index.android.bundle')?.kind,
    ).toBe('bundle');
    expect(
      resolveNativePackageEntry('android', 'res/drawable/icon.png')?.kind,
    ).toBe('resource');
    expect(
      resolveNativePackageEntry('harmony', 'resources/rawfile/assets/icon.png')
        ?.kind,
    ).toBe('resource');
  });

  test('repackages an APK with only the bundle and diffable resources', async () => {
    const source = path.join(tempRoot, 'source.apk');
    const output = path.join(tempRoot, 'slim.apk');
    await createZip(source, {
      'AndroidManifest.xml': 'manifest',
      'assets/index.android.bundle': 'bundle',
      'assets/data/config.json': 'config',
      'classes.dex': 'native-code',
      'lib/arm64-v8a/libapp.so': 'native-library',
      'res/drawable-xhdpi-v4/icon.webp': 'image',
      'resources.arsc': 'resource-table',
    });

    await createSlimNativePackage(source, output, 'android');

    const files = await readZipFiles(output);
    expect(Object.keys(files).sort()).toEqual([
      'assets/data/config.json',
      'assets/index.android.bundle',
      'res/drawable-xhdpi-v4/icon.webp',
      'resources.arsc',
    ]);
    expect(files['assets/index.android.bundle'].toString()).toBe('bundle');
    expect(files['resources.arsc'].toString()).toBe('resource-table');
  });

  test('resources.arsc is kept for the server but is not a diff origin', () => {
    expect(resolveNativePackageEntry('android', 'resources.arsc')).toBe(
      undefined,
    );
  });

  test('keeps resources.arsc only for Android', async () => {
    const source = path.join(tempRoot, 'source.ipa');
    const output = path.join(tempRoot, 'slim.ipa');
    await createZip(source, {
      'Payload/Test.app/main.jsbundle': 'bundle',
      'resources.arsc': 'resource-table',
    });
    await createSlimNativePackage(source, output, 'ios');
    expect(Object.keys(await readZipFiles(output))).toEqual([
      'Payload/Test.app/main.jsbundle',
    ]);
  });

  test('keeps IPA paths while dropping native executables and frameworks', async () => {
    const source = path.join(tempRoot, 'source.ipa');
    const output = path.join(tempRoot, 'slim.ipa');
    await createZip(source, {
      'Payload/Test.app/Test': 'executable',
      'Payload/Test.app/Frameworks/Hermes.framework/Hermes': 'framework',
      'Payload/Test.app/assets/icon.png': 'image',
      'Payload/Test.app/main.jsbundle': 'bundle',
      'SwiftSupport/libswiftCore.dylib': 'swift-runtime',
    });

    await createSlimNativePackage(source, output, 'ios');

    const files = await readZipFiles(output);
    expect(Object.keys(files).sort()).toEqual([
      'Payload/Test.app/assets/icon.png',
      'Payload/Test.app/main.jsbundle',
    ]);
  });

  test('rebuilds nested HAP archives without flattening the APP layout', async () => {
    const hap = path.join(tempRoot, 'entry.hap');
    const source = path.join(tempRoot, 'source.app');
    const output = path.join(tempRoot, 'slim.app');
    await createZip(hap, {
      'ets/modules.abc': 'native-code',
      'resources/rawfile/assets/icon.png': 'image',
      'resources/rawfile/bundle.harmony.js': 'bundle',
      'resources/rawfile/update.json': 'credentials',
    });
    await createZip(source, {
      'entry-default-signed.hap': fs.readFileSync(hap),
      'pack.info': 'metadata',
    });

    await createSlimNativePackage(source, output, 'harmony');

    const files = await readZipFiles(output);
    expect(files['entry-default-signed.hap']).toBeDefined();
    expect(
      files[
        'entry-default-signed.hap/resources/rawfile/bundle.harmony.js'
      ].toString(),
    ).toBe('bundle');
    expect(
      files['entry-default-signed.hap/resources/rawfile/assets/icon.png'],
    ).toBeDefined();
    expect(
      files['entry-default-signed.hap/resources/rawfile/update.json'],
    ).toBeUndefined();
    expect(files['pack.info']).toBeUndefined();
  });

  test('rejects a package when the shared rules find no bundle', async () => {
    const source = path.join(tempRoot, 'source.apk');
    const output = path.join(tempRoot, 'slim.apk');
    await createZip(source, {
      'assets/icon.png': 'image',
      'classes.dex': 'native-code',
    });

    await expect(
      createSlimNativePackage(source, output, 'android'),
    ).rejects.toThrow('Bundle entry not found');
    expect(fs.existsSync(output)).toBe(false);
  });
});

describe('raw-copy slim packages', () => {
  let tempRoot = '';
  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rnu-native-raw-'));
  });
  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  type EntryFacts = Record<
    string,
    { method: number; crc: number; csize: number; usize: number }
  >;
  async function entryFacts(filePath: string): Promise<EntryFacts> {
    const facts: EntryFacts = {};
    await enumZipEntries(filePath, async (entry) => {
      if (!entry.fileName.endsWith('/')) {
        facts[entry.fileName] = {
          method: entry.compressionMethod,
          crc: entry.crc32,
          csize: entry.compressedSize,
          usize: entry.uncompressedSize,
        };
      }
    });
    return facts;
  }

  async function writeMixedZip(output: string) {
    await new Promise<void>((resolve, reject) => {
      const zip = new YazlZipFile();
      zip.outputStream
        .pipe(fs.createWriteStream(output))
        .once('error', reject)
        .once('close', () => resolve());
      zip.addBuffer(
        Buffer.from('bundle '.repeat(5000)),
        'assets/index.android.bundle',
      );
      zip.addBuffer(Buffer.alloc(4096, 7), 'assets/stored.bin', {
        compress: false,
      });
      zip.addBuffer(Buffer.from('图片'.repeat(100)), 'res/drawable/图标.webp');
      zip.addBuffer(Buffer.from('dex'), 'classes.dex');
      zip.end();
    });
  }

  test('copies entries byte-for-byte: same method, crc and sizes as the source', async () => {
    const source = path.join(tempRoot, 'source.apk');
    const output = path.join(tempRoot, 'slim.apk');
    await writeMixedZip(source);
    await createSlimNativePackage(source, output, 'android');
    const [before, after] = await Promise.all([
      entryFacts(source),
      entryFacts(output),
    ]);
    expect(Object.keys(after).sort()).toEqual([
      'assets/index.android.bundle',
      'assets/stored.bin',
      'res/drawable/图标.webp',
    ]);
    for (const name of Object.keys(after)) {
      expect(after[name]).toEqual(before[name]);
    }
    expect(after['assets/stored.bin'].method).toBe(0);
    expect(after['assets/index.android.bundle'].method).toBe(8);
    const files = await readZipFiles(output);
    expect(files['assets/index.android.bundle'].toString()).toBe(
      'bundle '.repeat(5000),
    );
    expect(files['res/drawable/图标.webp'].toString()).toBe('图片'.repeat(100));
  });

  test('the yazl repack path produces the same content', async () => {
    const source = path.join(tempRoot, 'source.apk');
    const output = path.join(tempRoot, 'slim.apk');
    await writeMixedZip(source);
    await createSlimNativePackage(source, output, 'android', { repack: true });
    const files = await readZipFiles(output);
    expect(Object.keys(files).sort()).toEqual([
      'assets/index.android.bundle',
      'assets/stored.bin',
      'res/drawable/图标.webp',
    ]);
    expect(files['assets/stored.bin'].equals(Buffer.alloc(4096, 7))).toBe(true);
  });

  for (const repack of [false, true]) {
    test(`deflates a stored resources.arsc (repack: ${repack})`, async () => {
      const source = path.join(tempRoot, 'source.apk');
      const output = path.join(tempRoot, 'slim.apk');
      const table = Buffer.from('resource-table '.repeat(4000));
      await new Promise<void>((resolve, reject) => {
        const zip = new YazlZipFile();
        zip.outputStream
          .pipe(fs.createWriteStream(source))
          .once('error', reject)
          .once('close', () => resolve());
        zip.addBuffer(Buffer.from('bundle'), 'assets/index.android.bundle');
        zip.addBuffer(table, 'resources.arsc', { compress: false });
        zip.end();
      });
      await createSlimNativePackage(source, output, 'android', { repack });

      const [before, after] = await Promise.all([
        entryFacts(source),
        entryFacts(output),
      ]);
      expect(before['resources.arsc'].method).toBe(0);
      expect(after['resources.arsc'].method).toBe(8);
      expect(after['resources.arsc'].crc).toBe(before['resources.arsc'].crc);
      expect(after['resources.arsc'].usize).toBe(table.length);
      expect(after['resources.arsc'].csize).toBeLessThan(table.length);
      const files = await readZipFiles(output);
      expect(files['resources.arsc'].equals(table)).toBe(true);
    });
  }
});
