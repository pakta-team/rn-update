/**
 * [INPUT]: 无依赖（自包含 constexpr 常量），是解压资源上限的单一事实源
 * [OUTPUT]: 提供归档/总量/单条目/条目数/压缩比/清单/磁盘余量等伤害上限常量
 * [POS]: patch_core 的解压安全上限头，Java/ArkTS 镜像必须手动保持同步，iOS 直接包含
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
#ifndef PAKTA_PATCH_CORE_ARCHIVE_LIMITS_H_
#define PAKTA_PATCH_CORE_ARCHIVE_LIMITS_H_

// Single source of truth for the resource caps applied to an update package
// before and while it is unpacked. A corrupt or hostile archive must be able
// to cost at most a bounded amount of disk, memory and time — never a full
// disk or a zip bomb. The caps are generous for real packages (a large full
// bundle with assets is tens of MB) and exist purely as damage bounds.
//
// Mirrors that cannot include this header MUST stay in sync by hand:
//   - android/.../ArchiveLimits.java
//   - harmony/pakta/src/main/ets/ArchiveLimits.ts
// iOS (RCTPakta.mm) includes this header directly.

namespace pakta {
namespace archive_limits {

// Downloaded archive (Content-Length up front, streamed bytes as backstop).
constexpr long long kMaxArchiveBytes = 512LL * 1024 * 1024;
// Sum of every entry's uncompressed size.
constexpr long long kMaxTotalUncompressedBytes = 2048LL * 1024 * 1024;
// A single entry's uncompressed size.
constexpr long long kMaxEntryBytes = 512LL * 1024 * 1024;
// Number of entries in one archive.
constexpr long long kMaxEntries = 20000;
// Per-entry uncompressed/compressed ratio, checked only above
// kRatioCheckMinBytes (tiny highly-compressible files are legitimate).
constexpr long long kMaxCompressionRatio = 100;
constexpr long long kRatioCheckMinBytes = 1LL * 1024 * 1024;
// __diff.json is parsed fully in memory.
constexpr long long kMaxManifestBytes = 16LL * 1024 * 1024;
// Free disk required beyond the bytes about to be written.
constexpr long long kFreeDiskMarginBytes = 64LL * 1024 * 1024;
// A download whose length is unknown up front (chunked / encoded body) can
// only reserve the margin when the response arrives; the disk is re-probed
// before any write that would run past the bytes reserved so far, each
// probe reserving at least this many bytes ahead (a single larger chunk
// reserves its own size), so no write can ever eat into the margin.
constexpr long long kUnknownLengthFreeSpaceProbeBytes = 8LL * 1024 * 1024;

}  // namespace archive_limits
}  // namespace pakta

#endif  // PAKTA_PATCH_CORE_ARCHIVE_LIMITS_H_
