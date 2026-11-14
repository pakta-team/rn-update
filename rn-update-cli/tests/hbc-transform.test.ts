import { describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  compileLayoutToWire,
  findLayouts,
  getHbcVersion,
  HBC_LAYOUTS,
  HBC_TRANSFORM_VERSION,
  transformHbc,
  transformHbcFile,
  transformHbcWithLayout,
  transformHbcWithLayoutInPlace,
  tryTransformPair,
  tryTransformPairFiles,
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

/**
 * 构造一个结构合法的合成 v98 文件(不要求可被 hermes 执行,变换只关心结构)。
 * 各偏移表填入递增偏移,以真实地触发差分路径。
 */
function buildSyntheticV98(
  variant: 'late' | 'early' = 'late',
  mutate?: (counts: Record<string, number>) => void,
): Buffer {
  // 变体: 'late'(20 槽,含 numStringSwitchImms)| 'early'(19 槽)
  const layout = findLayouts(98)[variant === 'late' ? 0 : 1];
  if (!layout) throw new Error('v98 layout missing');

  const counts: Record<string, number> = {
    globalCodeIndex: 0,
    functionCount: 3,
    stringKindCount: 2,
    identifierCount: 4,
    stringCount: 5,
    overflowStringCount: 2,
    stringStorageSize: 32,
    bigIntCount: 2,
    bigIntStorageSize: 16,
    regExpCount: 2,
    regExpStorageSize: 8,
    literalValueBufferSize: 12,
    objKeyBufferSize: 8,
    objShapeTableCount: 2,
    segmentID: 0,
    cjsModuleCount: 1,
    functionSourceCount: 1,
  };
  mutate?.(counts);

  const align4 = (x: number) => (x + 3) & ~3;
  let off = 128;
  const sectionOffsets: {
    start: number;
    size: number;
    entrySize: number;
    delta: boolean;
  }[] = [];
  for (const s of layout.sections) {
    off = align4(off);
    const size = (counts[s.countField] ?? 0) * s.entrySize;
    sectionOffsets.push({
      start: off,
      size,
      entrySize: s.entrySize,
      delta: !!s.deltaFields?.length,
    });
    off += size;
  }
  const bytecodeSize = 40;
  const debugInfoOffset = align4(off) + bytecodeSize;
  const fileLength = debugInfoOffset + 24; // debug 区 + 20B footer 占位

  const buf = Buffer.alloc(fileLength);
  Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f]).copy(buf, 0);
  buf.writeUInt32LE(98, 8);
  counts.fileLength = fileLength;
  counts.debugInfoOffset = debugInfoOffset;
  layout.headerFields.forEach((name, i) => {
    buf.writeUInt32LE(counts[name] ?? 0, 32 + i * 4);
  });

  // 填充条目:首个 u32 写递增"偏移",其余字节写确定性噪声
  for (const s of sectionOffsets) {
    let seed = s.start * 7;
    for (let p = s.start; p < s.start + s.size; p++) {
      buf[p] = seed = (seed * 31 + 17) & 0xff;
    }
    if (s.entrySize >= 4) {
      let fakeOffset = 16;
      for (let p = s.start; p < s.start + s.size; p += s.entrySize) {
        buf.writeUInt32LE(fakeOffset & 0x01ffffff, p);
        fakeOffset += 24 + (p % 8);
      }
    }
  }
  return buf;
}

describe('hbcTransform', () => {
  test('recognizes fixture version and layout', () => {
    const a = fixture('v96-a.hbc');
    expect(getHbcVersion(a)).toBe(96);
    expect(findLayouts(96)).toHaveLength(1);
    expect(findLayouts(97)).toHaveLength(0);
    expect(findLayouts(98)).toHaveLength(2); // 晚期(20 槽)优先,早期(19 槽)兜底
  });

  test('transform is invertible on real v96 fixtures', () => {
    for (const name of ['v96-a.hbc', 'v96-b.hbc']) {
      const buf = fixture(name);
      const t = transformHbc(buf);
      expect(t).not.toBeNull();
      expect(Buffer.compare(t!, buf)).not.toBe(0); // 确实改写了字节
      const inv = transformHbc(t!, true);
      expect(inv).not.toBeNull();
      expect(Buffer.compare(inv!, buf)).toBe(0);
    }
  });

  test('transform is invertible on both synthetic v98 variants', () => {
    for (const variant of ['late', 'early'] as const) {
      const buf = buildSyntheticV98(variant);
      const t = transformHbc(buf);
      expect(t).not.toBeNull();
      expect(Buffer.compare(t!, buf)).not.toBe(0);
      const inv = transformHbc(t!, true);
      expect(Buffer.compare(inv!, buf)).toBe(0);
    }
  });

  test('v98 variant is resolved structurally, not by version alone', () => {
    // 同一版本号 98、两种头部布局:结构校验必须各自选中正确的候选
    const late = buildSyntheticV98('late');
    const early = buildSyntheticV98('early');
    const pairLate = tryTransformPair(late, late);
    const pairEarly = tryTransformPair(early, early);
    expect(pairLate).not.toBeNull();
    expect(pairEarly).not.toBeNull();
    expect(pairLate!.meta.layout.counts).toBe(20);
    expect(pairEarly!.meta.layout.counts).toBe(19);
  });

  test('transform only touches delta fields (v98 non-delta bytes intact)', () => {
    const buf = buildSyntheticV98('late');
    const t = transformHbc(buf)!;
    // 头部与 debugInfo 之后的区域必须逐字节一致(late 变体 debugInfo 在槽 19)
    expect(Buffer.compare(t.subarray(0, 128), buf.subarray(0, 128))).toBe(0);
    const dbg = buf.readUInt32LE(32 + 19 * 4);
    expect(Buffer.compare(t.subarray(dbg), buf.subarray(dbg))).toBe(0);
  });

  test('rejects malformed inputs', () => {
    const good = buildSyntheticV98();

    expect(transformHbc(Buffer.alloc(16))).toBeNull(); // 太短
    const badMagic = Buffer.from(good);
    badMagic[0] ^= 0xff;
    expect(transformHbc(badMagic)).toBeNull();

    const badVersion = Buffer.from(good);
    badVersion.writeUInt32LE(97, 8); // 不支持的版本
    expect(transformHbc(badVersion)).toBeNull();

    const truncated = good.subarray(0, good.length - 8); // fileLength 不匹配
    expect(transformHbc(Buffer.from(truncated))).toBeNull();

    const badCount = Buffer.from(good);
    badCount.writeUInt32LE(0x0fffffff, 32 + 2 * 4); // functionCount 爆表 → 段越界
    expect(transformHbc(badCount)).toBeNull();
  });

  test('tryTransformPair requires matching supported versions', () => {
    const a = fixture('v96-a.hbc');
    const b = fixture('v96-b.hbc');
    const pair = tryTransformPair(a, b);
    expect(pair).not.toBeNull();
    expect(pair!.meta.v).toBe(HBC_TRANSFORM_VERSION);
    expect(pair!.meta.hbcVersion).toBe(96);
    expect(pair!.meta.layout.counts).toBe(19);
    expect(pair!.meta.layout.sections.length).toBe(15);

    expect(tryTransformPair(a, buildSyntheticV98())).toBeNull(); // 版本不一致
    expect(tryTransformPair(Buffer.from('plain js'), b)).toBeNull();
  });

  test('wire format resolves count fields to header indices', () => {
    for (const layout of HBC_LAYOUTS) {
      const wire = compileLayoutToWire(layout);
      expect(wire.counts).toBe(layout.headerFields.length);
      for (const [countIndex, entrySize, deltaFields] of wire.sections) {
        expect(countIndex).toBeGreaterThanOrEqual(0);
        expect(countIndex).toBeLessThan(wire.counts);
        expect([1, 4, 8, 12, 16]).toContain(entrySize);
        for (const [byte, bit, bits] of deltaFields) {
          expect(byte + 4).toBeLessThanOrEqual(Math.max(entrySize, 4));
          expect(bit + bits).toBeLessThanOrEqual(32);
        }
      }
    }
  });

  test('transformed domain shrinks hdiff patch on real fixtures', () => {
    const hdiff = loadHdiff();
    if (!hdiff?.diff || !hdiff.patch) {
      console.warn('node-hdiffpatch unavailable; skipping size test');
      return;
    }
    const a = fixture('v96-a.hbc');
    const b = fixture('v96-b.hbc');
    const baseline = hdiff.diff(a, b);
    const pair = tryTransformPair(a, b)!;
    const transformed = hdiff.diff(pair.tOld, pair.tNew);
    expect(transformed.length).toBeLessThan(baseline.length);

    // 完整还原链:T(old) → patch → T⁻¹ === new
    const layout = findLayouts(96)[0]!;
    const patched = hdiff.patch(pair.tOld, transformed);
    const restored = transformHbcWithLayout(patched, layout, true);
    expect(restored).not.toBeNull();
    expect(Buffer.compare(restored!, b)).toBe(0);
  });

  test('in-place transform matches the copying one byte-for-byte', () => {
    const layout96 = findLayouts(96)[0]!;
    const cases: [Buffer, ReturnType<typeof findLayouts>[number]][] = [
      [fixture('v96-a.hbc'), layout96],
      [fixture('v96-b.hbc'), layout96],
      [buildSyntheticV98('late'), findLayouts(98)[0]!],
      [buildSyntheticV98('early'), findLayouts(98)[1]!],
    ];
    for (const [buf, layout] of cases) {
      const expected = transformHbcWithLayout(buf, layout, false)!;
      const inPlace = Buffer.from(buf);
      expect(transformHbcWithLayoutInPlace(inPlace, layout, false)).toBe(true);
      expect(Buffer.compare(inPlace, expected)).toBe(0);
      // and back again, in place, restores the original
      expect(transformHbcWithLayoutInPlace(inPlace, layout, true)).toBe(true);
      expect(Buffer.compare(inPlace, buf)).toBe(0);
    }

    // structural mismatch: returns false and leaves the buffer untouched
    const wrongLayout = Buffer.from(fixture('v96-a.hbc'));
    expect(
      transformHbcWithLayoutInPlace(wrongLayout, findLayouts(98)[0]!, false),
    ).toBe(false);
    expect(Buffer.compare(wrongLayout, fixture('v96-a.hbc'))).toBe(0);
  });

  test('transformHbcFile output equals transformHbcWithLayout on fixtures', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-hbc-file-'));
    try {
      const layout96 = findLayouts(96)[0]!;
      const inputs: [string, Buffer, ReturnType<typeof findLayouts>[number]][] =
        [
          ['v96-a', fixture('v96-a.hbc'), layout96],
          ['v96-b', fixture('v96-b.hbc'), layout96],
          ['v98-late', buildSyntheticV98('late'), findLayouts(98)[0]!],
          ['v98-early', buildSyntheticV98('early'), findLayouts(98)[1]!],
        ];
      for (const [name, buf, layout] of inputs) {
        const src = path.join(tempRoot, `${name}.hbc`);
        const forward = path.join(tempRoot, `${name}.t`);
        const back = path.join(tempRoot, `${name}.inv`);
        fs.writeFileSync(src, buf);

        expect(await transformHbcFile(src, forward, layout, false)).toBe(true);
        const expectedForward = transformHbcWithLayout(buf, layout, false)!;
        expect(Buffer.compare(fs.readFileSync(forward), expectedForward)).toBe(
          0,
        );
        // source file is left untouched
        expect(Buffer.compare(fs.readFileSync(src), buf)).toBe(0);

        expect(await transformHbcFile(forward, back, layout, true)).toBe(true);
        expect(Buffer.compare(fs.readFileSync(back), buf)).toBe(0);
        const expectedBack = transformHbcWithLayout(
          expectedForward,
          layout,
          true,
        )!;
        expect(Buffer.compare(fs.readFileSync(back), expectedBack)).toBe(0);
      }

      // non-HBC / structurally mismatched input: false, and no dst created
      const plain = path.join(tempRoot, 'plain.js');
      fs.writeFileSync(plain, 'var a = 1;');
      const plainOut = path.join(tempRoot, 'plain.t');
      expect(await transformHbcFile(plain, plainOut, layout96, false)).toBe(
        false,
      );
      expect(fs.existsSync(plainOut)).toBe(false);
      const wrongLayoutOut = path.join(tempRoot, 'wrong.t');
      expect(
        await transformHbcFile(
          path.join(tempRoot, 'v96-a.hbc'),
          wrongLayoutOut,
          findLayouts(98)[0]!,
          false,
        ),
      ).toBe(false);
      expect(fs.existsSync(wrongLayoutOut)).toBe(false);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('tryTransformPairFiles matches tryTransformPair', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-hbc-pair-'));
    try {
      const a = fixture('v96-a.hbc');
      const b = fixture('v96-b.hbc');
      const oldPath = path.join(tempRoot, 'old.hbc');
      const newPath = path.join(tempRoot, 'new.hbc');
      const tOldPath = path.join(tempRoot, 'old.t');
      const tNewPath = path.join(tempRoot, 'new.t');
      fs.writeFileSync(oldPath, a);
      fs.writeFileSync(newPath, b);

      const expected = tryTransformPair(a, b)!;
      const result = await tryTransformPairFiles(
        oldPath,
        newPath,
        tOldPath,
        tNewPath,
      );
      expect(result).not.toBeNull();
      expect(result!.layout).toBe(expected.layout);
      expect(result!.meta).toEqual(expected.meta);
      expect(Buffer.compare(fs.readFileSync(tOldPath), expected.tOld)).toBe(0);
      expect(Buffer.compare(fs.readFileSync(tNewPath), expected.tNew)).toBe(0);

      // version mismatch and non-HBC inputs: null, nothing written
      const v98Path = path.join(tempRoot, 'v98.hbc');
      fs.writeFileSync(v98Path, buildSyntheticV98());
      const plainPath = path.join(tempRoot, 'plain.js');
      fs.writeFileSync(plainPath, 'plain js');
      const outA = path.join(tempRoot, 'mismatch-old.t');
      const outB = path.join(tempRoot, 'mismatch-new.t');
      expect(
        await tryTransformPairFiles(oldPath, v98Path, outA, outB),
      ).toBeNull();
      expect(
        await tryTransformPairFiles(plainPath, newPath, outA, outB),
      ).toBeNull();
      expect(fs.existsSync(outA)).toBe(false);
      expect(fs.existsSync(outB)).toBe(false);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
