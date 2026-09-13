/**
 * [INPUT]: 依赖 java.io.File 的可用空间探测；手动镜像 cpp/patch_core/archive_limits.h
 * [OUTPUT]: 提供解压总量/条目数/压缩比等伤害上限常量与 ensureFreeSpace 磁盘余量守卫
 * [POS]: Android 的解压安全上限层，把损坏或恶意更新包的伤害限制在有限磁盘/内存/时间内
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
package cn.reactnative.modules.update;

/**
 * Java mirror of cpp/patch_core/archive_limits.h — keep the two in sync by
 * hand. Damage bounds for a corrupt or hostile update package.
 */
final class ArchiveLimits {
    static final long MAX_ARCHIVE_BYTES = 512L * 1024 * 1024;
    static final long MAX_TOTAL_UNCOMPRESSED_BYTES = 2048L * 1024 * 1024;
    static final long MAX_ENTRY_BYTES = 512L * 1024 * 1024;
    static final long MAX_ENTRIES = 20000;
    static final long MAX_COMPRESSION_RATIO = 100;
    static final long RATIO_CHECK_MIN_BYTES = 1L * 1024 * 1024;
    static final long MAX_MANIFEST_BYTES = 16L * 1024 * 1024;
    static final long FREE_DISK_MARGIN_BYTES = 64L * 1024 * 1024;
    static final long UNKNOWN_LENGTH_FREE_SPACE_PROBE_BYTES = 8L * 1024 * 1024;

    private ArchiveLimits() {
    }

    /**
     * Fails when the file system holding {@code target} cannot take
     * {@code bytesToWrite} more bytes plus the safety margin. 0 usable space
     * (unsupported file system) is treated as unknown and passes.
     */
    static void ensureFreeSpace(java.io.File target, long bytesToWrite)
        throws java.io.IOException {
        java.io.File probe = target;
        while (probe != null && !probe.exists()) {
            probe = probe.getParentFile();
        }
        if (probe == null) {
            return;
        }
        long usable = probe.getUsableSpace();
        if (usable <= 0) {
            return;
        }
        long needed = Math.max(0, bytesToWrite) + FREE_DISK_MARGIN_BYTES;
        if (usable < needed) {
            throw new java.io.IOException(
                "insufficient disk space: need " + needed + " bytes, have " + usable);
        }
    }
}
