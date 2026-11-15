/**
 * [INPUT]: 常量声明由 scripts/contract.json 的 archiveLimits 经 generate-contract.js 派生，无运行时依赖
 * [OUTPUT]: 提供归档/总量/单条目/条目数/压缩比/清单/磁盘余量等伤害上限常量
 * [POS]: patch_core 的解压安全上限消费头，iOS 直接包含，Java/ArkTS 对应声明由同一本地 contract 派生
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
#ifndef PAKTA_PATCH_CORE_ARCHIVE_LIMITS_H_
#define PAKTA_PATCH_CORE_ARCHIVE_LIMITS_H_

#include "patch_core.h"

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
constexpr long long kMaxArchiveBytes = 536870912LL;
// Sum of every entry's uncompressed size.
constexpr long long kMaxTotalUncompressedBytes = 2147483648LL;
// A single entry's uncompressed size.
constexpr long long kMaxEntryBytes = 536870912LL;
// Number of entries in one archive.
constexpr long long kMaxEntries = 20000LL;
// Per-entry uncompressed/compressed ratio, checked only above
// kRatioCheckMinBytes (tiny highly-compressible files are legitimate).
constexpr long long kMaxCompressionRatio = 100LL;
constexpr long long kRatioCheckMinBytes = 1048576LL;
// __diff.json is parsed fully in memory.
constexpr long long kMaxManifestBytes = 16777216LL;
// Free disk required beyond the bytes about to be written.
constexpr long long kFreeDiskMarginBytes = 67108864LL;
// A download whose length is unknown up front (chunked / encoded body) can
// only reserve the margin when the response arrives; the disk is re-probed
// before any write that would run past the bytes reserved so far, each
// probe reserving at least this many bytes ahead (a single larger chunk
// reserves its own size), so no write can ever eat into the margin.
constexpr long long kUnknownLengthFreeSpaceProbeBytes = 8388608LL;

using patch::Status;
bool IsReservedEntryName(const std::string& name);
Status CheckEntryCount(long long entries);
Status CheckUncompressedSize(long long archive_bytes, long long uncompressed_bytes);

class EntryAccumulator {
 public:
  explicit EntryAccumulator(long long archive_bytes) : archive_bytes_(archive_bytes) {}
  Status Accept(long long size, long long compressed, bool symlink,
                const std::string& name);
  Status AcceptExtracted(long long size, bool symlink, const std::string& name);
  long long entries() const { return entries_; }
  long long total_uncompressed() const { return total_; }
 private:
  long long archive_bytes_;
  long long entries_ = 0;
  long long total_ = 0;
  Status status_ = Status::Ok();
};

Status CheckExtractedDirectory(const std::string& dir, long long archive_bytes);

}  // namespace archive_limits
}  // namespace pakta

#endif  // PAKTA_PATCH_CORE_ARCHIVE_LIMITS_H_
