/**
 * [INPUT]: 依赖 @ohos.file.fs/statvfs、ErrorCodes 与 InstallRecord 的保留条目规则；上限声明由 scripts/contract.json 的 archiveLimits 派生，守卫逻辑不参与生成
 * [OUTPUT]: 提供解压总量/压缩比/条目数上限常量与 checkUncompressedSize/ensureFreeSpace/measureExtractedDirectory 守卫
 * [POS]: harmony/pakta 的解压安全上限层，把损坏或恶意更新包的伤害限制在有限磁盘/内存/时间内
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fileIo from '@ohos.file.fs';
import statvfs from '@ohos.file.statvfs';
import {
  ERROR_FILE_OPERATION_FAILED,
  createUpdateError,
} from './ErrorCodes';
import NativePatchCore from './NativePatchCore';

// ArkTS mirror of cpp/patch_core/archive_limits.h — keep in sync by hand
// (harmony/pakta/src/test/check-constant-parity.js asserts the values match).
// 损坏或恶意更新包的伤害上限:最多耗费有限的磁盘/内存/时间,绝不撑爆磁盘。
export const MAX_ARCHIVE_BYTES = 536870912;
export const MAX_TOTAL_UNCOMPRESSED_BYTES = 2147483648;
export const MAX_ENTRY_BYTES = 536870912;
export const MAX_ENTRIES = 20000;
export const MAX_COMPRESSION_RATIO = 100;
export const RATIO_CHECK_MIN_BYTES = 1048576;
export const MAX_MANIFEST_BYTES = 16777216;
export const FREE_DISK_MARGIN_BYTES = 67108864;
export const UNKNOWN_LENGTH_FREE_SPACE_PROBE_BYTES = 8388608;

/**
 * 解压前的总量校验(zlib.getOriginalSize 给出的归档解压后总字节数)。
 * zlib.decompressFile 没有逐条钩子,C++ 头文件里的逐条压缩比在这里只能按
 * 整包近似:总解压量超过上限、或(总量大于 RATIO_CHECK_MIN_BYTES 时)总压缩
 * 比超过 MAX_COMPRESSION_RATIO 即拒绝——20MB 归档 100:1 的 2GB 载荷在解压前
 * 就被挡下,而不是先解出来再量。
 */
export function checkUncompressedSize(
  archiveBytes: number,
  uncompressedBytes: number,
): void {
  NativePatchCore.installCheckUncompressedSize(archiveBytes, uncompressedBytes);
}

/**
 * 目标所在文件系统必须还能再写 bytesToWrite + 安全余量。取不到可用空间
 * (返回 0/异常)视为未知,放行。
 */
export async function ensureFreeSpace(
  target: string,
  bytesToWrite: number,
): Promise<void> {
  let probe = target;
  while (probe.length > 1 && !fileIo.accessSync(probe)) {
    const slash = probe.lastIndexOf('/');
    if (slash <= 0) {
      return;
    }
    probe = probe.substring(0, slash);
  }
  let free = 0;
  try {
    free = await statvfs.getFreeSize(probe);
  } catch (e) {
    return;
  }
  if (free <= 0) {
    return;
  }
  const needed = Math.max(0, bytesToWrite) + FREE_DISK_MARGIN_BYTES;
  if (free < needed) {
    throw createUpdateError(
      ERROR_FILE_OPERATION_FAILED,
      `insufficient disk space: need ${needed} bytes, have ${free}`,
    );
  }
}

/**
 * 递归统计目录里的条目数与总字节数;两者任一超过上限立即抛错(不必扫完)。
 * 同一趟遍历里拒绝任意深度的 `.pakta-` 保留条目(完成记录只能由 SDK 写)。
 */
export async function measureExtractedDirectory(
  directory: string,
  archiveBytes: number,
): Promise<void> {
  return NativePatchCore.installAuditExtractedDirectory(directory, archiveBytes);
}
