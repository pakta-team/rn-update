/**
 * [INPUT]: 依赖 archive_limits.h 的上限/累计器契约、install_record 保留前缀与 POSIX 目录元数据
 * [OUTPUT]: 实现保留路径检查、终止式条目累计、展开量/压缩比裁决与解压目录审计
 * [POS]: 三端安装的共享归档防线；不执行解压、下载或空间预留，扫描目录由平台安装锁保护
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
#include "archive_limits.h"

#include <cerrno>
#include <dirent.h>
#include <limits>
#include <sys/stat.h>

#include "install_record.h"

namespace pakta {
namespace archive_limits {
namespace {
bool ExceedsRatio(long long expanded, long long compressed) {
  if (expanded <= kRatioCheckMinBytes) return false;
  if (compressed <= 0) return true;
  if (compressed > std::numeric_limits<long long>::max() / kMaxCompressionRatio) return false;
  return expanded > compressed * kMaxCompressionRatio;
}
}
bool IsReservedEntryName(const std::string& name) {
  size_t start = 0;
  while (start < name.size()) {
    if (name.compare(start, std::char_traits<char>::length(install_record::kReservedPrefix),
                     install_record::kReservedPrefix) == 0) return true;
    const auto end = name.find_first_of("/\\", start);
    if (end == std::string::npos) break;
    start = end + 1;
  }
  return false;
}
Status CheckEntryCount(long long entries) {
  return entries < 0 || entries > kMaxEntries ? Status::Error("archive entry count exceeds limits") : Status::Ok();
}
Status CheckUncompressedSize(long long archive, long long size) {
  if (size < 0 || size > kMaxTotalUncompressedBytes) return Status::Error("archive expands beyond limits");
  if (ExceedsRatio(size, archive)) return Status::Error("archive compression ratio exceeds limits");
  return Status::Ok();
}
Status EntryAccumulator::Accept(long long size, long long compressed,
                                bool symlink, const std::string& name) {
  auto status = AcceptExtracted(size, symlink, name);
  if (status && ExceedsRatio(size, compressed)) status_ = Status::Error("archive entry compression ratio too high");
  return status_;
}
Status EntryAccumulator::AcceptExtracted(long long size, bool symlink,
                                         const std::string& name) {
  if (!status_) return status_;
  if (entries_ >= kMaxEntries) return status_ = Status::Error("archive has too many entries");
  ++entries_;
  if (IsReservedEntryName(name)) return status_ = Status::Error("archive contains reserved entry");
  if (symlink) return status_ = Status::Error("archive entry is a symlink");
  if (size < 0 || size > kMaxEntryBytes) return status_ = Status::Error("archive entry size invalid");
  if (size > kMaxTotalUncompressedBytes - total_) return status_ = Status::Error("archive expands beyond limits");
  total_ += size;
  return status_ = CheckUncompressedSize(archive_bytes_, total_);
}
Status CheckExtractedDirectory(const std::string& dir, long long archive) {
  struct stat root;
  if (lstat(dir.c_str(), &root) != 0 || !S_ISDIR(root.st_mode)) return Status::Error("invalid extracted directory");
  EntryAccumulator accumulator(archive);
  std::vector<std::string> pending(1);
  long long directories = 0;
  while (!pending.empty()) {
    const auto relative = pending.back();
    pending.pop_back();
    const auto path = relative.empty() ? dir : dir + "/" + relative;
    DIR* handle = opendir(path.c_str());
    if (!handle) return Status::Error("cannot list extracted directory");
    Status status = Status::Ok();
    while (status) {
      errno = 0;
      const auto* entry = readdir(handle);
      if (!entry) {
        if (errno) status = Status::Error("cannot read extracted directory");
        break;
      }
      const std::string name = entry->d_name;
      if (name == "." || name == "..") continue;
      const auto child = relative.empty() ? name : relative + "/" + name;
      struct stat info;
      if (lstat((dir + "/" + child).c_str(), &info) != 0) { status = Status::Error("cannot stat extracted entry"); break; }
      if (S_ISDIR(info.st_mode)) {
        if (++directories > kMaxEntries || IsReservedEntryName(child)) status = Status::Error("invalid extracted directories");
        else pending.push_back(child);
      } else if (!S_ISREG(info.st_mode)) {
        status = Status::Error("extracted entry is not a regular file");
      } else {
        status = accumulator.AcceptExtracted(info.st_size, false, child);
      }
    }
    closedir(handle);
    if (!status) return status;
  }
  return Status::Ok();
}
}
}
