/**
 * [INPUT]: 依赖 Hermes HBC 二进制布局、Buffer/文件句柄与差分字段规则
 * [OUTPUT]: 对外提供 HBC 布局探测、可逆变换、文件变换、段范围解析及版本元数据能力
 * [POS]: CLI Hermes delta 优化底座，为 base-bytecode 差分提供确定性字节变换
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

/**
 * Hermes 字节码(HBC)delta-friendly 可逆变换。
 *
 * 原理:HBC 中 functionHeaders / smallStringTable 等表的条目携带绝对偏移,
 * 任意一处内容增删都会让其后所有条目的偏移整体 +N,精确匹配型 diff(hdiff)
 * 无法复用这些被移位的条目。对这些偏移字段做前项差分(wrapping,模字段位宽)
 * 后,整体移位在差分域退化为单点变化,diff 显著变小。
 *
 * 布局描述表是纯数据:解释器(本文件 + 客户端 C 版)不含任何版本分支。
 * 新 Hermes 版本只需在 HBC_LAYOUTS 增加/扩展一个条目。CLI 生成 diff 时把
 * 实际使用的描述表以 wire 格式写入 __diff.json,客户端按表执行 T⁻¹,
 * 因此客户端无需跟进 HBC 版本。
 *
 * wrapping 差分与单调性无关、恒可逆:T⁻¹(T(x)) === x 对任意输入成立
 * (只要两侧使用同一份描述表)。
 */

import { copyFile, open as openFile, rm, stat } from 'node:fs/promises';

export const HBC_MAGIC = Buffer.from([
  0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f,
]);
const HEADER_COUNTS_OFFSET = 32; // magic(8) + version(4) + sourceHash(20)
export const HBC_HEADER_SIZE = 128;

/** 差分字段:条目内 byte 偏移处按小端读 u32,取 [bit, bit+bits) 位。 */
type DeltaField = { byte: number; bit: number; bits: number };

type SectionDesc = {
  name: string;
  /** 段大小 = header[countField] × entrySize;字节段 entrySize 为 1 */
  countField: string;
  entrySize: number;
  deltaFields?: DeltaField[];
};

export type HbcLayout = {
  minVersion: number;
  maxVersion: number;
  /** 头部 u32 计数字段名序列,从文件偏移 32 开始连续排列 */
  headerFields: string[];
  /** 各段按文件顺序排列(其后是函数字节码区,以 debugInfoOffset 为界) */
  sections: SectionDesc[];
};

const FUNC_OFFSET_25: DeltaField = { byte: 0, bit: 0, bits: 25 };
const STRING_OFFSET_23: DeltaField = { byte: 0, bit: 1, bits: 23 };
const PAIR_OFFSET_32: DeltaField = { byte: 0, bit: 0, bits: 32 };

// 晚期 v98 与 v99 共用的头部计数字段
const V98_LATE_HEADER_FIELDS = [
  'fileLength',
  'globalCodeIndex',
  'functionCount',
  'stringKindCount',
  'identifierCount',
  'stringCount',
  'overflowStringCount',
  'stringStorageSize',
  'bigIntCount',
  'bigIntStorageSize',
  'regExpCount',
  'regExpStorageSize',
  'literalValueBufferSize',
  'objKeyBufferSize',
  'objShapeTableCount',
  'numStringSwitchImms',
  'segmentID',
  'cjsModuleCount',
  'functionSourceCount',
  'debugInfoOffset',
];

// v98 两种头部变体(及 v99)共享的段布局
const V98_SECTIONS: SectionDesc[] = [
  {
    name: 'functionHeaders',
    countField: 'functionCount',
    entrySize: 12,
    deltaFields: [FUNC_OFFSET_25],
  },
  { name: 'stringKinds', countField: 'stringKindCount', entrySize: 4 },
  { name: 'identifierHashes', countField: 'identifierCount', entrySize: 4 },
  {
    name: 'smallStringTable',
    countField: 'stringCount',
    entrySize: 4,
    deltaFields: [STRING_OFFSET_23],
  },
  {
    name: 'overflowStringTable',
    countField: 'overflowStringCount',
    entrySize: 8,
    deltaFields: [PAIR_OFFSET_32],
  },
  { name: 'stringStorage', countField: 'stringStorageSize', entrySize: 1 },
  {
    name: 'literalValueBuffer',
    countField: 'literalValueBufferSize',
    entrySize: 1,
  },
  { name: 'objKeyBuffer', countField: 'objKeyBufferSize', entrySize: 1 },
  // ShapeTableEntry 8B:{keyBufferOffset u32, numProps u32}
  {
    name: 'objShapeTable',
    countField: 'objShapeTableCount',
    entrySize: 8,
    deltaFields: [PAIR_OFFSET_32],
  },
  {
    name: 'bigIntTable',
    countField: 'bigIntCount',
    entrySize: 8,
    deltaFields: [PAIR_OFFSET_32],
  },
  { name: 'bigIntStorage', countField: 'bigIntStorageSize', entrySize: 1 },
  {
    name: 'regExpTable',
    countField: 'regExpCount',
    entrySize: 8,
    deltaFields: [PAIR_OFFSET_32],
  },
  { name: 'regExpStorage', countField: 'regExpStorageSize', entrySize: 1 },
  { name: 'cjsModuleTable', countField: 'cjsModuleCount', entrySize: 8 },
  {
    name: 'functionSourceTable',
    countField: 'functionSourceCount',
    entrySize: 8,
  },
];

/**
 * 布局描述表(唯一需要跟随 Hermes 版本演进的数据)。
 * 字段序照抄 hermes 源码 include/hermes/BCGen/HBC/BytecodeFileFormat.h。
 * v97 为 Static Hermes 短期预览版本,生产占比为零,不支持(自动回退)。
 */
export const HBC_LAYOUTS: HbcLayout[] = [
  {
    // hermes 0.12 主线(RN 0.69~0.81+),v87 引入 bigInt 字段后布局稳定
    minVersion: 87,
    maxVersion: 96,
    headerFields: [
      'fileLength',
      'globalCodeIndex',
      'functionCount',
      'stringKindCount',
      'identifierCount',
      'stringCount',
      'overflowStringCount',
      'stringStorageSize',
      'bigIntCount',
      'bigIntStorageSize',
      'regExpCount',
      'regExpStorageSize',
      'arrayBufferSize',
      'objKeyBufferSize',
      'objValueBufferSize',
      'segmentID',
      'cjsModuleCount',
      'functionSourceCount',
      'debugInfoOffset',
    ],
    sections: [
      // SmallFuncHeader 16B:word0 offset:25|paramCount:7,word2 infoOffset:25|frameSize:7
      {
        name: 'functionHeaders',
        countField: 'functionCount',
        entrySize: 16,
        deltaFields: [FUNC_OFFSET_25, { byte: 8, bit: 0, bits: 25 }],
      },
      { name: 'stringKinds', countField: 'stringKindCount', entrySize: 4 },
      { name: 'identifierHashes', countField: 'identifierCount', entrySize: 4 },
      // SmallStringTableEntry 4B:isUTF16:1|offset:23|length:8
      {
        name: 'smallStringTable',
        countField: 'stringCount',
        entrySize: 4,
        deltaFields: [STRING_OFFSET_23],
      },
      // OverflowStringTableEntry 8B:{offset u32, length u32}
      {
        name: 'overflowStringTable',
        countField: 'overflowStringCount',
        entrySize: 8,
        deltaFields: [PAIR_OFFSET_32],
      },
      { name: 'stringStorage', countField: 'stringStorageSize', entrySize: 1 },
      { name: 'arrayBuffer', countField: 'arrayBufferSize', entrySize: 1 },
      { name: 'objKeyBuffer', countField: 'objKeyBufferSize', entrySize: 1 },
      {
        name: 'objValueBuffer',
        countField: 'objValueBufferSize',
        entrySize: 1,
      },
      {
        name: 'bigIntTable',
        countField: 'bigIntCount',
        entrySize: 8,
        deltaFields: [PAIR_OFFSET_32],
      },
      { name: 'bigIntStorage', countField: 'bigIntStorageSize', entrySize: 1 },
      {
        name: 'regExpTable',
        countField: 'regExpCount',
        entrySize: 8,
        deltaFields: [PAIR_OFFSET_32],
      },
      { name: 'regExpStorage', countField: 'regExpStorageSize', entrySize: 1 },
      { name: 'cjsModuleTable', countField: 'cjsModuleCount', entrySize: 8 },
      {
        name: 'functionSourceTable',
        countField: 'functionSourceCount',
        entrySize: 8,
      },
    ],
  },
  {
    // Static Hermes 晚期 v98(生产观测到的主流形态):相对早期 v98 头部
    // 多一个 numStringSwitchImms 槽(hermes static_h 在不 bump 版本号的
    // 情况下插入,同一版本号 98 因此存在两种布局,依结构校验区分)。
    // 段布局与早期 v98 相同。
    // Hermes V1 v99(hermes-compiler 260318099,RN 0.88+)文件头与段布局
    // 同晚期 v98,只改了函数头内部位域(去 NumCacheNewObject)与操作码表,
    // 二者都不在本变换触及的范围内。
    minVersion: 98,
    maxVersion: 99,
    headerFields: V98_LATE_HEADER_FIELDS,
    sections: V98_SECTIONS,
  },
  {
    // Static Hermes 早期 v98(hermes c00cc57595 时点,无 numStringSwitchImms)。
    // 相对 v96:SmallFuncHeader 16B→12B(去 infoOffset/environmentSize);
    // objValueBuffer(字节段)→ objShapeTable(8B 条目);
    // arrayBufferSize 更名 literalValueBufferSize(槽位不变)。
    minVersion: 98,
    maxVersion: 98,
    headerFields: V98_LATE_HEADER_FIELDS.filter(
      (field) => field !== 'numStringSwitchImms',
    ),
    sections: V98_SECTIONS,
  },
];

/**
 * 随 patch 下发的 wire 格式(客户端 C 解释器的输入,全数字、无名字):
 * counts: 头部 u32 计数字段个数(从偏移 32 起连续读取)
 * sections: [countIndex, entrySize, [[byte, bit, bits], ...]][]
 *
 * 位置约定(C 端校验依赖,两端必须一致):
 * counts 槽位 0 = fileLength,最后一个槽位 = debugInfoOffset。
 */
export type HbcLayoutWire = {
  counts: number;
  sections: [number, number, [number, number, number][]][];
};

export function compileLayoutToWire(layout: HbcLayout): HbcLayoutWire {
  if (
    layout.headerFields[0] !== 'fileLength' ||
    layout.headerFields[layout.headerFields.length - 1] !== 'debugInfoOffset'
  ) {
    throw new Error(
      'HbcLayout must start with fileLength and end with debugInfoOffset',
    );
  }
  return {
    counts: layout.headerFields.length,
    sections: layout.sections.map((s) => [
      layout.headerFields.indexOf(s.countField),
      s.entrySize,
      (s.deltaFields ?? []).map(
        (f) => [f.byte, f.bit, f.bits] as [number, number, number],
      ),
    ]),
  };
}

export function getHbcVersion(buf: Buffer): number | null {
  if (buf.length < HBC_HEADER_SIZE) return null;
  if (!buf.subarray(0, 8).equals(HBC_MAGIC)) return null;
  return buf.readUInt32LE(8);
}

/** 同一版本号可能有多个候选布局(按声明顺序即优先级)。 */
export function findLayouts(version: number): HbcLayout[] {
  return HBC_LAYOUTS.filter(
    (l) => version >= l.minVersion && version <= l.maxVersion,
  );
}

type ResolvedSection = { start: number; size: number; desc: SectionDesc };

const align4 = (x: number) => (x + 3) & ~3;

/**
 * 按描述表解析并校验段边界。任何不一致(截断、计数越界、段区间超出
 * debugInfoOffset)都返回 null——调用方回退到不变换路径。
 * 描述表视为不可信输入,所有算术做显式边界检查。
 */
function resolveSections(
  buf: Buffer,
  layout: HbcLayout,
): ResolvedSection[] | null {
  return resolveSectionsFromHeader(buf, buf.length, layout);
}

/**
 * 只依赖头部 128 字节与文件总长即可解析段边界(表偏移全部来自头部计数),
 * 文件版变换据此无需把整个 bundle 读进内存。
 */
function resolveSectionsFromHeader(
  header: Buffer,
  fileLength: number,
  layout: HbcLayout,
): ResolvedSection[] | null {
  const headerEnd = HEADER_COUNTS_OFFSET + layout.headerFields.length * 4;
  if (
    header.length < HBC_HEADER_SIZE ||
    fileLength < HBC_HEADER_SIZE ||
    headerEnd > HBC_HEADER_SIZE
  ) {
    return null;
  }

  const counts: Record<string, number> = {};
  layout.headerFields.forEach((name, i) => {
    counts[name] = header.readUInt32LE(HEADER_COUNTS_OFFSET + i * 4);
  });

  if (counts.fileLength !== fileLength) return null;
  const debugInfoOffset = counts.debugInfoOffset;
  if (
    !Number.isInteger(debugInfoOffset) ||
    debugInfoOffset < HBC_HEADER_SIZE ||
    debugInfoOffset > fileLength
  ) {
    return null;
  }

  const resolved: ResolvedSection[] = [];
  let off = HBC_HEADER_SIZE;
  for (const desc of layout.sections) {
    const count = counts[desc.countField];
    if (count === undefined || count > 0x0fffffff) return null;
    const size = count * desc.entrySize;
    off = align4(off);
    if (off + size > debugInfoOffset) return null;
    for (const f of desc.deltaFields ?? []) {
      // 差分字段必须完整落在条目内且可用一次 u32 读写覆盖
      if (
        f.bits < 1 ||
        f.bits > 32 ||
        f.bit + f.bits > 32 ||
        f.byte + 4 > desc.entrySize
      ) {
        return null;
      }
    }
    resolved.push({ start: off, size, desc });
    off += size;
  }
  return resolved;
}

/** Byte range of one section of an HBC file (see resolveHbcSections). */
export type HbcSectionRange = { start: number; size: number };

/**
 * Section byte ranges of an HBC file from its 128-byte header and total
 * length, keyed by section name (arrayBuffer, objKeyBuffer, ... for v87–96;
 * literalValueBuffer, objShapeTable, ... for v98). Null when no known layout
 * fits, which callers treat as "cannot read this file structurally".
 */
export function resolveHbcSections(
  header: Buffer,
  fileLength: number,
): {
  version: number;
  layout: HbcLayout;
  sections: Map<string, HbcSectionRange>;
} | null {
  const version = getHbcVersion(header);
  if (version === null) return null;
  for (const layout of findLayouts(version)) {
    const resolved = resolveSectionsFromHeader(header, fileLength, layout);
    if (resolved) {
      return {
        version,
        layout,
        sections: new Map(
          resolved.map((s) => [s.desc.name, { start: s.start, size: s.size }]),
        ),
      };
    }
  }
  return null;
}

function applyDelta(
  out: Buffer,
  section: ResolvedSection,
  inverse: boolean,
): void {
  const { start, size, desc } = section;
  for (const f of desc.deltaFields ?? []) {
    // bits === 32 时掩码为全 1;>>> 保持无符号语义
    const mask = f.bits === 32 ? 0xffffffff : ((1 << f.bits) - 1) << f.bit;
    const fieldMask = f.bits === 32 ? 0xffffffff : (1 << f.bits) - 1;
    let prev = 0;
    for (let p = start + f.byte; p < start + size; p += desc.entrySize) {
      const word = out.readUInt32LE(p);
      const val = (word >>> f.bit) & fieldMask;
      let enc: number;
      if (!inverse) {
        enc = (val - prev) & fieldMask;
        prev = val;
      } else {
        enc = (val + prev) & fieldMask;
        prev = enc;
      }
      out.writeUInt32LE(((word & ~mask) | (enc << f.bit)) >>> 0, p);
    }
  }
}

/**
 * 对 HBC buffer 执行变换(inverse=false)或逆变换(inverse=true)。
 * 同一版本号可能存在多个候选布局(如 v98 早/晚两种头部),按声明顺序
 * 取第一个通过结构校验的。非 HBC / 无可用布局 → 返回 null。
 * 注意:变换不改动头部计数,同一文件正/逆向解析选中的布局必然一致。
 */
export function transformHbc(buf: Buffer, inverse = false): Buffer | null {
  const layout = pickLayout(buf);
  if (!layout) return null;
  return transformHbcWithLayout(buf, layout, inverse);
}

/** 返回该 buffer 结构上匹配的布局(候选中第一个校验通过者)。 */
function pickLayout(buf: Buffer): HbcLayout | null {
  const version = getHbcVersion(buf);
  if (version === null) return null;
  for (const layout of findLayouts(version)) {
    if (resolveSections(buf, layout)) return layout;
  }
  return null;
}

export function transformHbcWithLayout(
  buf: Buffer,
  layout: HbcLayout,
  inverse: boolean,
): Buffer | null {
  const sections = resolveSections(buf, layout);
  if (!sections) return null;
  const out = Buffer.from(buf);
  applyDeltaSections(out, sections, inverse);
  return out;
}

/**
 * 原地变换:直接改写 buf,不再分配整块副本。调用方须持有 buf 的所有权
 * (例如 patch() 刚返回的新 Buffer)。结构不匹配时返回 false 且 buf 不变。
 */
export function transformHbcWithLayoutInPlace(
  buf: Buffer,
  layout: HbcLayout,
  inverse: boolean,
): boolean {
  const sections = resolveSections(buf, layout);
  if (!sections) return false;
  applyDeltaSections(buf, sections, inverse);
  return true;
}

function applyDeltaSections(
  out: Buffer,
  sections: ResolvedSection[],
  inverse: boolean,
): void {
  for (const s of sections) {
    if (s.desc.deltaFields?.length) applyDelta(out, s, inverse);
  }
}

type HbcFileHeader = { header: Buffer; size: number };

/** 读取文件头 128 字节与总长;文件过短或非 HBC 时返回 null。 */
export async function readHbcFileHeader(
  filePath: string,
): Promise<HbcFileHeader | null> {
  const { size } = await stat(filePath);
  if (size < HBC_HEADER_SIZE) return null;
  const header = Buffer.alloc(HBC_HEADER_SIZE);
  const handle = await openFile(filePath, 'r');
  try {
    await readExact(handle, header, 0);
  } finally {
    await handle.close();
  }
  if (getHbcVersion(header) === null) return null;
  return { header, size };
}

type FileHandleLike = Awaited<ReturnType<typeof openFile>>;

async function readExact(
  handle: FileHandleLike,
  buffer: Buffer,
  position: number,
): Promise<void> {
  let done = 0;
  while (done < buffer.length) {
    const { bytesRead } = await handle.read(
      buffer,
      done,
      buffer.length - done,
      position + done,
    );
    if (bytesRead <= 0) {
      throw new Error('unexpected end of file while reading HBC section');
    }
    done += bytesRead;
  }
}

async function writeExact(
  handle: FileHandleLike,
  buffer: Buffer,
  position: number,
): Promise<void> {
  let done = 0;
  while (done < buffer.length) {
    const { bytesWritten } = await handle.write(
      buffer,
      done,
      buffer.length - done,
      position + done,
    );
    if (bytesWritten <= 0) {
      throw new Error('short write while rewriting HBC section');
    }
    done += bytesWritten;
  }
}

/**
 * 文件版 transformHbcWithLayout:把 src 复制到 dst,再仅对含差分字段的
 * 段(位于 [128, 最后一段末尾) 区间内)做定位读写改写。任一时刻内存中
 * 只有一个段的内容,不会持有整个 bundle。输出与内存版逐字节一致。
 * 结构不匹配时返回 false 并清理 dst。
 */
export async function transformHbcFile(
  src: string,
  dst: string,
  layout: HbcLayout,
  inverse: boolean,
): Promise<boolean> {
  const info = await readHbcFileHeader(src);
  const sections = info
    ? resolveSectionsFromHeader(info.header, info.size, layout)
    : null;
  if (!sections) {
    return false;
  }
  await copyFile(src, dst);
  try {
    const handle = await openFile(dst, 'r+');
    try {
      for (const s of sections) {
        if (!s.desc.deltaFields?.length || s.size === 0) continue;
        const chunk = Buffer.alloc(s.size);
        await readExact(handle, chunk, s.start);
        applyDelta(chunk, { start: 0, size: s.size, desc: s.desc }, inverse);
        await writeExact(handle, chunk, s.start);
      }
    } finally {
      await handle.close();
    }
  } catch (error) {
    await rm(dst, { force: true });
    throw error;
  }
  return true;
}

export const HBC_TRANSFORM_VERSION = 1;

export type HbcTransformMeta = {
  v: number;
  hbcVersion: number;
  layout: HbcLayoutWire;
};

/** 两侧共同的 HBC 版本;任一侧不是 HBC 或版本不同时为 null */
function sharedHbcVersion(oldHeader: Buffer, newHeader: Buffer): number | null {
  const version = getHbcVersion(newHeader);
  return version !== null && getHbcVersion(oldHeader) === version
    ? version
    : null;
}

function transformMeta(
  hbcVersion: number,
  layout: HbcLayout,
): HbcTransformMeta {
  return {
    v: HBC_TRANSFORM_VERSION,
    hbcVersion,
    layout: compileLayoutToWire(layout),
  };
}

/**
 * 若 old/new 均为同版本且存在两侧都通过结构校验的候选布局,返回变换结果、
 * 选中布局与写入 __diff.json 的元数据;否则返回 null。
 */
export function tryTransformPair(
  oldBuf: Buffer,
  newBuf: Buffer,
): {
  tOld: Buffer;
  tNew: Buffer;
  layout: HbcLayout;
  meta: HbcTransformMeta;
} | null {
  const version = sharedHbcVersion(oldBuf, newBuf);
  if (version === null) return null;
  for (const layout of findLayouts(version)) {
    const tOld = transformHbcWithLayout(oldBuf, layout, false);
    const tNew = transformHbcWithLayout(newBuf, layout, false);
    if (!tOld || !tNew) continue;
    return { tOld, tNew, layout, meta: transformMeta(version, layout) };
  }
  return null;
}

/**
 * tryTransformPair 的文件版:只读两侧头部即可选定布局,变换结果直接写到
 * tOldPath / tNewPath,全程不把 bundle 读进内存。无可用布局时返回 null
 * (不产生输出文件)。
 */
export async function tryTransformPairFiles(
  oldPath: string,
  newPath: string,
  tOldPath: string,
  tNewPath: string,
): Promise<{ layout: HbcLayout; meta: HbcTransformMeta } | null> {
  const [oldInfo, newInfo] = await Promise.all([
    readHbcFileHeader(oldPath),
    readHbcFileHeader(newPath),
  ]);
  if (!oldInfo || !newInfo) return null;
  const version = sharedHbcVersion(oldInfo.header, newInfo.header);
  if (version === null) return null;
  for (const layout of findLayouts(version)) {
    if (
      !resolveSectionsFromHeader(oldInfo.header, oldInfo.size, layout) ||
      !resolveSectionsFromHeader(newInfo.header, newInfo.size, layout)
    ) {
      continue;
    }
    const [tOld, tNew] = await Promise.all([
      transformHbcFile(oldPath, tOldPath, layout, false),
      transformHbcFile(newPath, tNewPath, layout, false),
    ]);
    if (!tOld || !tNew) continue;
    return { layout, meta: transformMeta(version, layout) };
  }
  return null;
}
