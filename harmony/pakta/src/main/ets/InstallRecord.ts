/**
 * [INPUT]: 依赖 @ohos.file.fs、@kit.ArkTS util、NativePatchCore 与 ErrorCodes；schema/记录名/staging 后缀由 scripts/contract.json 的 installRecord 派生，IO 与摘要校验不参与生成
 * [OUTPUT]: 提供两阶段安装完成记录（.pakta-complete）的构建/写入(fsync)/解析/校验与 staging 目录、保留条目前缀工具
 * [POS]: harmony/pakta 的安装完整性层，原子 rename 前落记录、激活前重验 bundle 摘要；仅空文本/零字节文件返回内部历史 marker 对象，非空 JSON 空对象不享兼容豁免
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import NativePatchCore from './NativePatchCore';
import { ERROR_SWITCH_VERSION_FAILED, createUpdateError } from './ErrorCodes';

// ArkTS mirror of cpp/patch_core/install_record.h — keep in sync by hand
// (harmony/pakta/src/test/check-constant-parity.js asserts the values match).
// 两阶段安装的完成记录:作为安装最后一步写进 staging 目录,随后 staging
// 原子 rename 成版本目录;激活前重新校验 bundle 摘要。空文件 = 旧版 SDK
// 写的历史标记,仍视为完整安装(无摘要可验)。
export const INSTALL_RECORD_SCHEMA = 1;
export const INSTALL_RECORD_FILE_NAME = '.pakta-complete';
export const STAGING_SUFFIX = '.staging';
// 归档不得携带任何 `.pakta-` 前缀的条目(任意深度):这些名字保留给 SDK 自己
// 写的记录,与 Android 的规则一致。
export const RESERVED_ENTRY_PREFIX = '.pakta-';
export const HARMONY_BUNDLE_FILE_NAME = 'bundle.harmony.js';

export interface InstallRecordData {
  schema?: number;
  versionHash?: string;
  bundleSha256?: string;
  artifactSha256?: string;
}

const LEGACY_EMPTY_RECORD: InstallRecordData = {};

export function stagingDirectoryFor(versionDir: string): string {
  return `${versionDir}${STAGING_SUFFIX}`;
}

export function isReservedEntryName(name: string): boolean {
  return NativePatchCore.installIsReservedEntry(name);
}

export function buildInstallRecord(
  versionHash: string,
  bundleSha256: string,
  artifactSha256: string,
): string {
  return NativePatchCore.installBuildRecord(versionHash, bundleSha256, artifactSha256);
}

/** 写入并 fsync:紧随其后的 rename 必须能在盘上看到它。 */
export async function writeInstallRecord(
  versionDir: string,
  recordJson: string,
): Promise<void> {
  return NativePatchCore.installWriteRecord(versionDir, recordJson);
}

/**
 * 解析记录文本:空串(历史标记)返回 {};畸形/非对象返回 null。纯函数,
 * 供 readInstallRecord 与单测共用。
 */
export function parseInstallRecord(text: string): InstallRecordData | null {
  const record = NativePatchCore.installParseRecord(text);
  return record?.legacy ? LEGACY_EMPTY_RECORD : record;
}

/**
 * 读取记录:文件缺失/畸形返回 null;空文件(历史标记)返回 {}。
 */
export function readInstallRecord(versionDir: string): InstallRecordData | null {
  const record = NativePatchCore.installReadRecord(versionDir);
  return record?.legacy ? LEGACY_EMPTY_RECORD : record;
}

/** 记录是否宣告本版本完整安装(历史空记录视为是)。纯函数。 */
export function isRecordForVersion(
  record: InstallRecordData | null,
  versionHash: string,
): boolean {
  if (record === null) {
    return false;
  }
  if (record === LEGACY_EMPTY_RECORD) {
    return true;
  }
  return (
    record.schema === INSTALL_RECORD_SCHEMA && record.versionHash === versionHash
  );
}

/** 存在性判定(启动/去重路径,不算摘要):记录存在且(非历史空文件时)指向本版本。 */
export function isInstallComplete(versionDir: string, versionHash: string): boolean {
  return NativePatchCore.installIsComplete(versionDir, versionHash);
}

/**
 * 激活前的记录校验(不含摘要):返回需要复核的 bundle 摘要,仅历史空记录
 * 返回空串;记录缺失/不符或缺摘要(schema 1 必填)抛 SWITCH_VERSION_FAILED。
 * 纯函数。
 */
export function expectedBundleSha256ForActivation(
  record: InstallRecordData | null,
  versionHash: string,
): string {
  if (record === null) {
    throw createUpdateError(
      ERROR_SWITCH_VERSION_FAILED,
      `Bundle version ${versionHash} has no valid completion record.`,
    );
  }
  if (record === LEGACY_EMPTY_RECORD) {
    return '';
  }
  if (
    record.schema !== INSTALL_RECORD_SCHEMA ||
    record.versionHash !== versionHash
  ) {
    throw createUpdateError(
      ERROR_SWITCH_VERSION_FAILED,
      `Bundle version ${versionHash} completion record mismatch.`,
    );
  }
  const expected = record.bundleSha256;
  if (typeof expected !== 'string' || !/^[a-fA-F0-9]{64}$/.test(expected)) {
    throw createUpdateError(
      ERROR_SWITCH_VERSION_FAILED,
      `Bundle version ${versionHash} completion record mismatch.`,
    );
  }
  return expected;
}

/**
 * 激活前校验:记录带摘要时在 native 工作线程重新计算 bundle 摘要(整包
 * 几十 MB,不能在 UI 线程同步算);不通过则抛错说明原因。
 */
export async function verifyInstallForActivation(
  versionDir: string,
  versionHash: string,
  bundlePath: string,
  grandfathered: boolean = false,
): Promise<object> {
  if (bundlePath !== `${versionDir}/${HARMONY_BUNDLE_FILE_NAME}`) {
    throw createUpdateError(
      ERROR_SWITCH_VERSION_FAILED,
      `Bundle version ${versionHash} invalid bundle path.`,
    );
  }
  return NativePatchCore.installCheckActivation(versionDir, versionHash, grandfathered);
}

export function assertInstallActivationUnchanged(snapshot: object): void {
  NativePatchCore.installActivationUnchanged(snapshot);
}
