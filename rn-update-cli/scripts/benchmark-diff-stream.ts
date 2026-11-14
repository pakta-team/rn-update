/**
 * [INPUT]: 依赖 CLI 差分模块、node-hdiffpatch、临时文件与 ZIP 构造能力
 * [OUTPUT]: 对外提供大体积流式差分/还原的开发基准命令
 * [POS]: scripts 性能探针，不进入生产 CLI 调度路径
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ZipFile as YazlZipFile } from 'yazl';

type DiffCommandsModule = {
  diffCommands: {
    hdiff(context: {
      args: string[];
      options: Record<string, unknown>;
    }): Promise<void>;
  };
  enumZipEntries(
    zipPath: string,
    callback: (entry: any, zipFile: any) => Promise<void>,
  ): Promise<void>;
  readEntry(entry: any, zipFile: any): Promise<Buffer>;
};

type HdiffModule = {
  diff: (
    oldData: Buffer,
    newData: Buffer,
    callback: (error: Error | null, output?: Buffer) => void,
  ) => void;
  diffWindow: (
    oldPath: string,
    newPath: string,
    outputPath: string,
    windowSize: number,
    callback: (error: Error | null, output?: string) => void,
  ) => void;
  patchSingleStream: (
    oldPath: string,
    diffPath: string,
    outputPath: string,
    callback: (error: Error | null, output?: string) => void,
  ) => void;
};

async function createZip(zipPath: string, bundle: Buffer) {
  await new Promise<void>((resolve, reject) => {
    const zip = new YazlZipFile();
    zip.outputStream.on('error', reject);
    zip.outputStream
      .pipe(fs.createWriteStream(zipPath))
      .on('close', resolve)
      .on('error', reject);
    zip.addBuffer(bundle, 'index.bundlejs', { compress: false });
    zip.end();
  });
}

function fillDeterministic(buffer: Buffer, seed: number) {
  let value = seed >>> 0;
  for (let index = 0; index < buffer.length; index += 1) {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    buffer[index] = value & 0xff;
  }
}

async function prepareFixtures(root: string, sizeBytes: number) {
  const oldBundle = Buffer.allocUnsafe(sizeBytes);
  fillDeterministic(oldBundle, 0x12345678);
  const newBundle = Buffer.from(oldBundle);
  const changedBytes = Math.max(1, Math.floor(sizeBytes / 100));
  const changeStart = Math.floor(sizeBytes / 2);
  for (let index = 0; index < changedBytes; index += 1) {
    newBundle[changeStart + index] ^= (index % 251) + 1;
  }
  const oldPath = path.join(root, 'old.ppk');
  const newPath = path.join(root, 'new.ppk');
  await Promise.all([
    createZip(oldPath, oldBundle),
    createZip(newPath, newBundle),
  ]);
  return { oldPath, newPath };
}

async function runWorker() {
  const modulePath = process.argv[3];
  const oldPath = process.argv[4];
  const newPath = process.argv[5];
  const outputPath = process.argv[6];
  const verified = process.argv[7] !== 'unverified';
  if (!modulePath || !oldPath || !newPath || !outputPath) {
    throw new Error('missing worker arguments');
  }
  const diffModule = require(modulePath) as DiffCommandsModule;
  const { diffCommands } = diffModule;
  const hdiff = require('node-hdiffpatch') as HdiffModule;
  const diffAsync = promisify(hdiff.diff);
  const diffWindowAsync = (
    oldFile: string,
    newFile: string,
    patchFile: string,
  ) =>
    new Promise<string>((resolve, reject) => {
      hdiff.diffWindow(
        oldFile,
        newFile,
        patchFile,
        32 * 1024 * 1024,
        (error, output) =>
          error || !output
            ? reject(error ?? new Error('diffWindow returned no output'))
            : resolve(output),
      );
    });
  const patchSingleStreamAsync = promisify(hdiff.patchSingleStream);
  const startRssBytes = process.memoryUsage().rss;
  let peakRssBytes = startRssBytes;
  const sampler = setInterval(() => {
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  }, 5);
  const startedAt = performance.now();
  try {
    await diffCommands.hdiff({
      args: [oldPath, newPath],
      options: {
        output: outputPath,
        customDiff: diffAsync,
        customDiffSingleStream: diffWindowAsync,
        customDiffSingleStreamVerified: verified,
        customPatchSingleStream: patchSingleStreamAsync,
        bundleStreamThreshold: 1,
      },
    });
  } finally {
    clearInterval(sampler);
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  }
  const elapsedMs = performance.now() - startedAt;
  let patchData: Buffer | undefined;
  await diffModule.enumZipEntries(outputPath, async (entry, zipFile) => {
    if (entry.fileName === 'index.bundlejs.patch') {
      patchData = await diffModule.readEntry(entry, zipFile);
    }
  });
  if (!patchData) {
    throw new Error('benchmark output does not contain bundle patch');
  }
  console.log(
    `BENCH_RESULT ${JSON.stringify({
      elapsedMs,
      outputBytes: fs.statSync(outputPath).size,
      patchBytes: patchData.length,
      patchSha256: createHash('sha256').update(patchData).digest('hex'),
      peakDeltaBytes: peakRssBytes - startRssBytes,
      peakRssBytes,
      startRssBytes,
      verified,
    })}`,
  );
}

async function main() {
  if (process.argv[2] === '--worker') {
    await runWorker();
    return;
  }
  const sizeMiB = Number(process.env.DIFF_BENCH_SIZE_MIB ?? 32);
  if (!Number.isFinite(sizeMiB) || sizeMiB <= 0) {
    throw new Error('DIFF_BENCH_SIZE_MIB must be a positive number');
  }
  const modulePath = path.resolve(
    process.argv[2] ?? path.join(__dirname, '..', 'src', 'diff.ts'),
  );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rnu-diff-bench-'));
  try {
    const { oldPath, newPath } = await prepareFixtures(
      root,
      Math.floor(sizeMiB * 1024 * 1024),
    );
    const outputPath = path.join(root, 'output.ppk');
    const child = Bun.spawn(
      [
        process.execPath,
        __filename,
        '--worker',
        modulePath,
        oldPath,
        newPath,
        outputPath,
        process.env.DIFF_BENCH_UNVERIFIED === '1' ? 'unverified' : 'verified',
      ],
      { stdout: 'inherit', stderr: 'inherit' },
    );
    const exitCode = await child.exited;
    if (exitCode !== 0) {
      throw new Error(`benchmark worker exited with ${exitCode}`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
