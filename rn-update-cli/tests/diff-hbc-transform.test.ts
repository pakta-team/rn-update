import { describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ZipFile as YazlZipFile } from 'yazl';
import { diffCommands, enumZipEntries, readEntry } from '../src/diff';
import type { CommandContext } from '../src/types';
import {
  findLayouts,
  transformHbc,
  transformHbcWithLayout,
} from '../src/utils/hbcTransform';

const fixture = (name: string) =>
  fs.readFileSync(path.join(__dirname, 'fixtures', 'hbc', name));

function loadHdiff():
  | {
      diff: (a: Buffer, b: Buffer) => Buffer;
      patch: (a: Buffer, d: Buffer) => Buffer;
    }
  | undefined {
  try {
    return require('node-hdiffpatch');
  } catch {
    return undefined;
  }
}

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

describe('hdiff with hbcTransform', () => {
  const hdiff = loadHdiff();
  const itIfHdiff = hdiff?.diff && hdiff.patch ? test : test.skip;

  async function runHdiff(options: Record<string, unknown>) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-hbc-diff-'));
    const originPath = path.join(tempRoot, 'origin.ppk');
    const nextPath = path.join(tempRoot, 'next.ppk');
    const outputPath = path.join(tempRoot, 'out.ppk');
    await createZip(originPath, {
      'index.bundlejs': fixture('v96-a.hbc'),
      'assets/same.txt': Buffer.from('same'),
    });
    await createZip(nextPath, {
      'index.bundlejs': fixture('v96-b.hbc'),
      'assets/same.txt': Buffer.from('same'),
    });
    await diffCommands.hdiff({
      args: [originPath, nextPath],
      options: { output: outputPath, ...options },
    } as CommandContext);
    const files = await readZipFiles(outputPath);
    fs.rmSync(tempRoot, { recursive: true, force: true });
    return files;
  }

  itIfHdiff(
    'emits transformed patch with layout metadata and restores exactly',
    async () => {
      const files = await runHdiff({
        hbcTransform: true,
        hbcTransformMinBaseline: 0,
      });
      const manifest = JSON.parse(files['__diff.json'].toString('utf8'));
      const meta = manifest.hbcTransform?.['index.bundlejs.patch'];
      expect(meta?.v).toBe(1);
      expect(meta?.hbcVersion).toBe(96);
      expect(meta?.layout?.counts).toBe(19);
      expect(Array.isArray(meta?.layout?.sections)).toBe(true);

      // 客户端视角完整还原:T(old) → hpatch → T⁻¹ === new
      const oldBundle = fixture('v96-a.hbc');
      const newBundle = fixture('v96-b.hbc');
      const tOld = transformHbc(oldBundle)!;
      const patched = hdiff!.patch(tOld, files['index.bundlejs.patch']);
      const restored = transformHbcWithLayout(
        patched,
        findLayouts(meta.hbcVersion)[0]!,
        true,
      );
      expect(restored).not.toBeNull();
      expect(Buffer.compare(restored!, newBundle)).toBe(0);

      // 变换域 patch 必须小于 baseline(择优生效的前提)
      const baseline = hdiff!.diff(oldBundle, newBundle);
      expect(files['index.bundlejs.patch'].length).toBeLessThan(
        baseline.length,
      );
    },
  );

  itIfHdiff(
    'default (option off) emits plain patch without metadata',
    async () => {
      const files = await runHdiff({});
      const manifest = JSON.parse(files['__diff.json'].toString('utf8'));
      expect(manifest.hbcTransform).toBeUndefined();

      const restored = hdiff!.patch(
        fixture('v96-a.hbc'),
        files['index.bundlejs.patch'],
      );
      expect(Buffer.compare(restored, fixture('v96-b.hbc'))).toBe(0);
    },
  );

  itIfHdiff(
    'small-baseline pruning keeps plain patch even when option is on',
    async () => {
      // 默认 64KB 阈值:fixture baseline 仅 ~1KB,应直接走 baseline
      const files = await runHdiff({ hbcTransform: true });
      const manifest = JSON.parse(files['__diff.json'].toString('utf8'));
      expect(manifest.hbcTransform).toBeUndefined();
    },
  );

  test('non-hermes bundles never produce transform metadata', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-hbc-plain-'));
    const originPath = path.join(tempRoot, 'origin.ppk');
    const nextPath = path.join(tempRoot, 'next.ppk');
    const outputPath = path.join(tempRoot, 'out.ppk');
    await createZip(originPath, { 'index.bundlejs': Buffer.from('var a=1;') });
    await createZip(nextPath, { 'index.bundlejs': Buffer.from('var a=2;') });
    await diffCommands.hdiff({
      args: [originPath, nextPath],
      options: {
        output: outputPath,
        hbcTransform: true,
        hbcTransformMinBaseline: 0,
        customDiff: (o?: Buffer, n?: Buffer) =>
          Buffer.from(`p:${o?.length}:${n?.length}`),
        customPatch: (o: Buffer, d: Buffer) => Buffer.concat([o, d]),
      },
    } as CommandContext);
    const files = await readZipFiles(outputPath);
    fs.rmSync(tempRoot, { recursive: true, force: true });
    const manifest = JSON.parse(files['__diff.json'].toString('utf8'));
    expect(manifest.hbcTransform).toBeUndefined();
    expect(files['index.bundlejs.patch'].toString('utf8')).toBe('p:8:8');
  });
});
