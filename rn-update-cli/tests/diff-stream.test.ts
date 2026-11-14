import { describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ZipFile as YazlZipFile } from 'yazl';
import { diffCommands, enumZipEntries, readEntry } from '../src/diff';
import type { CommandContext } from '../src/types';
import {
  transformHbc,
  transformHbcWithLayout,
  tryTransformPair,
} from '../src/utils/hbcTransform';

const fixture = (name: string) =>
  fs.readFileSync(path.join(__dirname, 'fixtures', 'hbc', name));

type HdiffFull = {
  diff: (a: Buffer, b: Buffer) => Buffer;
  patch: (a: Buffer, d: Buffer) => Buffer;
  diffStream: (o: string, n: string, out: string) => string;
  patchStream: (o: string, d: string, out: string) => string;
  diffSingleStream: (o: string, n: string, out: string) => string;
  patchSingleStream: (o: string, d: string, out: string) => string;
};

function loadHdiff(): HdiffFull | undefined {
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

const HDIFF13_MAGIC = 'HDIFF13&';
const SINGLE_MAGIC = 'HDIFFSF20';

describe('hdiff with bundleStreamThreshold (large-bundle stream path)', () => {
  const hdiff = loadHdiff();
  const canStream = !!(hdiff?.diffStream && hdiff.patchStream);
  const itIfStream = canStream ? test : test.skip;

  async function runHdiff(
    bundles: { origin: Buffer; next: Buffer },
    options: Record<string, unknown>,
  ) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-stream-diff-'));
    const originPath = path.join(tempRoot, 'origin.ppk');
    const nextPath = path.join(tempRoot, 'next.ppk');
    const outputPath = path.join(tempRoot, 'out.ppk');
    await createZip(originPath, { 'index.bundlejs': bundles.origin });
    await createZip(nextPath, { 'index.bundlejs': bundles.next });
    await diffCommands.hdiff({
      args: [originPath, nextPath],
      options: { output: outputPath, ...options },
    } as CommandContext);
    const files = await readZipFiles(outputPath);
    fs.rmSync(tempRoot, { recursive: true, force: true });
    return files;
  }

  itIfStream(
    'emits single-format stream patch with transform metadata and restores exactly',
    async () => {
      const origin = fixture('v96-a.hbc');
      const next = fixture('v96-b.hbc');
      const files = await runHdiff(
        { origin, next },
        {
          hbcTransform: true,
          bundleStreamThreshold: 1, // 强制走流式路径
        },
      );
      const patchData = files['index.bundlejs.patch'];
      // node-hdiffpatch >= 2.0 提供 diffSingleStream → single 优先
      expect(patchData.subarray(0, 9).toString('latin1')).toBe(SINGLE_MAGIC);

      const manifest = JSON.parse(files['__diff.json'].toString('utf8'));
      const meta = manifest.hbcTransform?.['index.bundlejs.patch'];
      expect(meta?.v).toBe(1);

      // 客户端视角还原:T(old) → patch(single) → T⁻¹ === new
      const hd = loadHdiff() as unknown as HdiffFull;
      const patched = hd.patch(transformHbc(origin)!, patchData);
      const pair = tryTransformPair(origin, next)!;
      const restored = transformHbcWithLayout(patched, pair.layout, true);
      expect(restored).not.toBeNull();
      expect(Buffer.compare(restored!, next)).toBe(0);
    },
  );

  itIfStream(
    'falls back to HDIFF13 when only diffStream/patchStream are available',
    async () => {
      const hd = loadHdiff() as unknown as HdiffFull & Record<string, unknown>;
      // 只暴露 13 系能力,模拟 node-hdiffpatch 1.x 环境
      const legacyModule = {
        diff: hd.diff,
        patch: hd.patch,
        diffStream: hd.diffStream,
        patchStream: hd.patchStream,
      };
      const origin = fixture('v96-a.hbc');
      const next = fixture('v96-b.hbc');
      const files = await runHdiff(
        { origin, next },
        {
          customHdiffModule: legacyModule,
          hbcTransform: true,
          bundleStreamThreshold: 1,
        },
      );
      const patchData = files['index.bundlejs.patch'];
      expect(patchData.subarray(0, 8).toString('latin1')).toBe(HDIFF13_MAGIC);

      // T(old) → patchStream → T⁻¹ === new
      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-sr-'));
      const oldFile = path.join(tempRoot, 'old');
      const patchFile = path.join(tempRoot, 'p');
      const outFile = path.join(tempRoot, 'out');
      fs.writeFileSync(oldFile, transformHbc(origin)!);
      fs.writeFileSync(patchFile, patchData);
      hdiff!.patchStream(oldFile, patchFile, outFile);
      const pair = tryTransformPair(origin, next)!;
      const restored = transformHbcWithLayout(
        fs.readFileSync(outFile),
        pair.layout,
        true,
      );
      fs.rmSync(tempRoot, { recursive: true, force: true });
      expect(restored).not.toBeNull();
      expect(Buffer.compare(restored!, next)).toBe(0);
    },
  );

  itIfStream(
    'prefers single-format stream when diffSingleStream is available',
    async () => {
      // 注入 single-stream 实现(node-hdiffpatch >= 2.0.0 提供;此处以
      // customHdiffModule 显式注入,老依赖环境下同样可测)
      const hd = loadHdiff() as Record<string, unknown>;
      const singleModule = {
        ...hd,
        diffSingleStream:
          (hd.diffSingleStream as unknown) ??
          ((o: string, n: string, out: string) => {
            // 老依赖没有 single-stream 时,用内存 diff 模拟同格式产物
            fs.writeFileSync(
              out,
              (hd as HdiffFull).diff(fs.readFileSync(o), fs.readFileSync(n)),
            );
            return out;
          }),
        patchSingleStream:
          (hd.patchSingleStream as unknown) ??
          ((o: string, d: string, out: string) => {
            fs.writeFileSync(
              out,
              (hd as HdiffFull).patch(fs.readFileSync(o), fs.readFileSync(d)),
            );
            return out;
          }),
      };
      const origin = fixture('v96-a.hbc');
      const next = fixture('v96-b.hbc');
      const files = await runHdiff(
        { origin, next },
        {
          customHdiffModule: singleModule,
          hbcTransform: true,
          bundleStreamThreshold: 1,
        },
      );
      const patchData = files['index.bundlejs.patch'];
      // single 优先:产物是 HDIFFSF20,老客户端可直接应用
      expect(patchData.subarray(0, 9).toString('latin1')).toBe(SINGLE_MAGIC);
      const manifest = JSON.parse(files['__diff.json'].toString('utf8'));
      expect(manifest.hbcTransform?.['index.bundlejs.patch']?.v).toBe(1);
    },
  );

  itIfStream(
    'non-hermes large bundles get a plain single-format stream patch without metadata',
    async () => {
      const origin = Buffer.from(`var a='${'x'.repeat(4000)}';`);
      const next = Buffer.from(`var a='${'x'.repeat(4000)}';var b=2;`);
      const files = await runHdiff(
        { origin, next },
        {
          hbcTransform: true,
          bundleStreamThreshold: 1,
        },
      );
      const patchData = files['index.bundlejs.patch'];
      expect(patchData.subarray(0, 9).toString('latin1')).toBe(SINGLE_MAGIC);
      const manifest = JSON.parse(files['__diff.json'].toString('utf8'));
      expect(manifest.hbcTransform).toBeUndefined();

      // single 产物直接用 patch() 还原
      const restored = (loadHdiff() as unknown as HdiffFull).patch(
        origin,
        patchData,
      );
      expect(Buffer.compare(restored, next)).toBe(0);
    },
  );

  itIfStream(
    'skips a duplicate round trip for an explicitly verified stream diff',
    async () => {
      const hd = loadHdiff() as unknown as HdiffFull;
      let patchCalls = 0;
      const phases: Array<{ phase: string; skipped?: boolean }> = [];
      const origin = Buffer.from(`var a='${'x'.repeat(4000)}';`);
      const next = Buffer.from(`var a='${'x'.repeat(4000)}';var b=2;`);
      const files = await runHdiff(
        { origin, next },
        {
          bundleStreamThreshold: 1,
          customHdiffModule: {
            diff: hd.diff,
            patch: hd.patch,
            diffSingleStream: hd.diffSingleStream,
            patchSingleStream: (
              oldPath: string,
              diffPath: string,
              outPath: string,
            ) => {
              patchCalls += 1;
              return hd.patchSingleStream(oldPath, diffPath, outPath);
            },
            capabilities: {
              diffSingleStreamVerifiesOutput: true,
            },
          },
          onDiffPhase: (metric: { phase: string; skipped?: boolean }) => {
            phases.push(metric);
          },
        },
      );

      expect(patchCalls).toBe(0);
      expect(phases.map(({ phase }) => phase)).toEqual([
        'materialize',
        'diff',
        'verify',
      ]);
      expect(phases.at(-1)?.skipped).toBe(true);
      expect(
        Buffer.compare(hd.patch(origin, files['index.bundlejs.patch']), next),
      ).toBe(0);
    },
  );

  itIfStream(
    'keeps round-trip verification for an unverified custom stream diff',
    async () => {
      const hd = loadHdiff() as unknown as HdiffFull;
      let patchCalls = 0;
      const phases: Array<{ phase: string; skipped?: boolean }> = [];
      const origin = Buffer.from(`var a='${'x'.repeat(4000)}';`);
      const next = Buffer.from(`var a='${'x'.repeat(4000)}';var b=2;`);
      await runHdiff(
        { origin, next },
        {
          bundleStreamThreshold: 1,
          customDiff: hd.diff,
          customDiffSingleStream: hd.diffSingleStream,
          customPatchSingleStream: (
            oldPath: string,
            diffPath: string,
            outPath: string,
          ) => {
            patchCalls += 1;
            return hd.patchSingleStream(oldPath, diffPath, outPath);
          },
          onDiffPhase: (metric: { phase: string; skipped?: boolean }) => {
            phases.push(metric);
          },
        },
      );

      expect(patchCalls).toBe(1);
      expect(phases.at(-1)?.phase).toBe('verify');
      expect(phases.at(-1)?.skipped).toBeUndefined();
    },
  );

  itIfStream(
    'stream path drops the hbc transform when its patch is not smaller than baseline',
    async () => {
      // 该 diff 把补丁写成完整的 new 内容:raw/transformed 两个候选大小
      // 几乎一致,加上元数据开销后变换候选必然不占优,必须回退 baseline
      const copyDiff = (_o: string, n: string, out: string) => {
        fs.writeFileSync(out, fs.readFileSync(n));
        return out;
      };
      const copyPatch = (_o: string, d: string, out: string) => {
        fs.writeFileSync(out, fs.readFileSync(d));
        return out;
      };
      const origin = fixture('v96-a.hbc');
      const next = fixture('v96-b.hbc');
      const files = await runHdiff(
        { origin, next },
        {
          hbcTransform: true,
          bundleStreamThreshold: 1,
          customDiff: (loadHdiff() as HdiffFull).diff,
          customDiffSingleStream: copyDiff,
          customPatchSingleStream: copyPatch,
        },
      );
      const manifest = JSON.parse(files['__diff.json'].toString('utf8'));
      expect(manifest.hbcTransform).toBeUndefined();
      // 采用的是 raw 基线候选:补丁内容就是未变换的 new bundle
      expect(Buffer.compare(files['index.bundlejs.patch'], next)).toBe(0);
    },
  );

  itIfStream(
    'bundles below the threshold keep the in-memory single-format path',
    async () => {
      const origin = fixture('v96-a.hbc');
      const next = fixture('v96-b.hbc');
      const files = await runHdiff(
        { origin, next },
        {
          bundleStreamThreshold: 1024 * 1024 * 1024, // 阈值远大于 bundle
        },
      );
      const patchData = files['index.bundlejs.patch'];
      expect(patchData.subarray(0, 8).toString('latin1')).not.toBe(
        HDIFF13_MAGIC,
      );
      const restored = hdiff!.patch(origin, patchData);
      expect(Buffer.compare(restored, next)).toBe(0);
    },
  );
});
