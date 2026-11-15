/**
 * [INPUT]: 依赖 install_record.h 契约、digest 的 SHA-256、flow_json 有界解析及 POSIX 文件 IO
 * [OUTPUT]: 实现记录读写、封存晋升、完整性查询、激活摘要与文件快照复核
 * [POS]: 三端安装的文件完整性实现；不拥有下载、平台状态锁、版本删除或持久状态提交
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
#include "install_record.h"

#include <cerrno>
#include <cstdio>
#include <cstring>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#include <tuple>

#include "digest.h"
#include "../update_flow_core/flow_json.h"

namespace pakta {
namespace install_record {
namespace {
std::string Path(const std::string& dir) { return dir + "/" + kFileName; }
Status Failure(const std::string& hash, const std::string& reason) {
  return Status::Error("Bundle version " + hash + " " + reason);
}
bool HexDigest(const std::string& value) {
  if (value.size() != 64) return false;
  for (char c : value) {
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') ||
          (c >= 'A' && c <= 'F'))) return false;
  }
  return true;
}
std::string Lower(std::string value) {
  for (char& c : value) if (c >= 'A' && c <= 'F') c += 'a' - 'A';
  return value;
}
void SyncDirectory(const std::string& dir) {
  const int fd = open(dir.c_str(), O_RDONLY | O_CLOEXEC | O_DIRECTORY);
  if (fd < 0) return;
  while (fsync(fd) != 0 && errno == EINTR) {}
  close(fd);
}
Record::State ReadText(const std::string& dir, std::string* text) {
  const int fd = open(Path(dir).c_str(), O_RDONLY | O_CLOEXEC | O_NONBLOCK | O_NOFOLLOW);
  if (fd < 0) return errno == ENOENT ? Record::State::kAbsent : Record::State::kInvalid;
  struct stat before;
  if (fstat(fd, &before) != 0 || !S_ISREG(before.st_mode) || before.st_size < 0 ||
      before.st_size > kMaxRecordBytes) {
    close(fd);
    return Record::State::kInvalid;
  }
  std::string content;
  char buffer[4096];
  bool failed = false;
  for (;;) {
    const ssize_t count = read(fd, buffer, sizeof(buffer));
    if (count < 0 && errno == EINTR) continue;
    if (count < 0) { failed = true; break; }
    if (count == 0) break;
    content.append(buffer, static_cast<size_t>(count));
    if (content.size() > static_cast<size_t>(kMaxRecordBytes)) { failed = true; break; }
  }
  struct stat after;
  if (fstat(fd, &after) != 0 || before.st_size != after.st_size ||
      content.size() != static_cast<size_t>(before.st_size)) failed = true;
  close(fd);
  if (failed) return Record::State::kInvalid;
  const auto record = Parse(content);
  if (record.state == Record::State::kPresent) *text = content;
  return record.state;
}
bool BundleName(const std::string& name) {
  return !name.empty() && name != "." && name != ".." &&
         name.find_first_of("/\\\0", 0, 3) == std::string::npos;
}
}

Record Parse(const std::string& text) {
  Record record;
  if (text.empty()) { record.state = Record::State::kLegacy; return record; }
  record.state = Record::State::kInvalid;
  flowjson::ParseLimits limits;
  limits.max_input_bytes = kMaxRecordBytes;
  limits.max_nodes = 1024;
  bool ok = false;
  const auto root = flowjson::Parse(text, limits, &ok);
  if (!ok || !root.IsObject()) return record;
  record.state = Record::State::kPresent;
  const auto& schema = root.Get("schema");
  record.current_schema = schema.IsNumber() && schema.AsNumber() == kSchema;
  const auto string = [&](const char* key) {
    const auto& value = root.Get(key);
    return value.IsString() ? value.AsString() : std::string();
  };
  record.version_hash = string("versionHash");
  record.bundle_sha256 = string("bundleSha256");
  record.artifact_sha256 = string("artifactSha256");
  return record;
}
bool Names(const Record& record, const std::string& hash) {
  return record.state == Record::State::kPresent && record.current_schema &&
         !hash.empty() && record.version_hash == hash;
}
Record Read(const std::string& dir) {
  std::string text;
  const auto state = ReadText(dir, &text);
  if (state == Record::State::kPresent) return Parse(text);
  Record record;
  record.state = state;
  return record;
}
bool HasRecordFile(const std::string& dir) {
  struct stat info;
  return lstat(Path(dir).c_str(), &info) == 0 || errno != ENOENT;
}
Status Build(const std::string& hash, const std::string& bundle,
             const std::string& artifact, std::string* out) {
  if (!out || hash.empty() || !HexDigest(bundle)) return Failure(hash, "has no valid bundle digest.");
  auto record = flowjson::Value::Object();
  record.Set("schema", flowjson::Value::Number(kSchema));
  record.Set("versionHash", flowjson::Value::String(hash));
  record.Set("bundleSha256", flowjson::Value::String(bundle));
  if (!artifact.empty()) record.Set("artifactSha256", flowjson::Value::String(artifact));
  const auto text = flowjson::Stringify(record);
  if (Parse(text).state != Record::State::kPresent) return Failure(hash, "record exceeds limits.");
  *out = text;
  return Status::Ok();
}
Status Write(const std::string& dir, const std::string& text) {
  const auto record = Parse(text);
  if (!Names(record, record.version_hash) || !HexDigest(record.bundle_sha256))
    return Status::Error("invalid completion record");
  std::string temp = Path(dir) + ".tmp.XXXXXX";
  const int fd = mkstemp(&temp[0]);
  if (fd < 0) return Status::Error("cannot create completion record");
  bool ok = true;
  size_t offset = 0;
  while (offset < text.size()) {
    const ssize_t count = write(fd, text.data() + offset, text.size() - offset);
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) { ok = false; break; }
    offset += static_cast<size_t>(count);
  }
  while (ok && fsync(fd) != 0) if (errno != EINTR) ok = false;
  if (close(fd) != 0) ok = false;
  if (ok) ok = rename(temp.c_str(), Path(dir).c_str()) == 0;
  if (!ok) { unlink(temp.c_str()); return Status::Error("cannot write completion record"); }
  SyncDirectory(dir);
  return Status::Ok();
}
SealResult Seal(const std::string& dir, const std::string& hash,
                const std::string& name, const std::string& artifact,
                const std::string& known) {
  SealResult result;
  const auto before = StampFile(dir + "/" + name);
  if (!BundleName(name) || !before.regular) {
    result.status = Status::Error("bundle missing after install"); return result;
  }
  const auto actual = digest::Sha256File(dir + "/" + name);
  if (StampFile(dir + "/" + name) != before ||
      (!known.empty() && Lower(known) != actual)) {
    result.status = Status::Error("bundle changed or known digest mismatch"); return result;
  }
  std::string text;
  result.status = Build(hash, actual, artifact, &text);
  if (!result.status) return result;
  result.status = Write(dir, text);
  result.file_failure = !result.status.ok;
  return result;
}
Status Promote(const std::string& staging, const std::string& version) {
  const auto slash = version.find_last_of('/');
  const auto hash = slash == std::string::npos ? version : version.substr(slash + 1);
  const auto record = Read(staging);
  if (!Names(record, hash) || !HexDigest(record.bundle_sha256)) return Status::Error("staging is not sealed");
  struct stat info;
  if (lstat(version.c_str(), &info) == 0 || errno != ENOENT) return Status::Error("version destination exists or is inaccessible");
  if (rename(staging.c_str(), version.c_str()) != 0) return Status::Error("cannot promote staging");
  SyncDirectory(slash == std::string::npos ? "." : slash == 0 ? "/" : version.substr(0, slash));
  return Status::Ok();
}
bool IsComplete(const std::string& dir, const std::string& hash, const std::string& name) {
  if (!BundleName(name) || !StampFile(dir + "/" + name).regular) return false;
  const auto record = Read(dir);
  return record.state == Record::State::kLegacy || Names(record, hash);
}
std::string RecordedBundleSha256(const std::string& dir) { return Read(dir).bundle_sha256; }
bool FileStamp::operator==(const FileStamp& b) const {
  return std::tie(regular, device, inode, size, modified_sec, modified_nsec, changed_sec, changed_nsec) ==
         std::tie(b.regular, b.device, b.inode, b.size, b.modified_sec, b.modified_nsec, b.changed_sec, b.changed_nsec);
}
FileStamp StampFile(const std::string& path) {
  FileStamp stamp;
  struct stat info;
  if (lstat(path.c_str(), &info) != 0 || !S_ISREG(info.st_mode)) return stamp;
  stamp.regular = true;
  stamp.device = info.st_dev; stamp.inode = info.st_ino; stamp.size = info.st_size;
#if defined(__APPLE__)
  stamp.modified_sec = info.st_mtimespec.tv_sec; stamp.modified_nsec = info.st_mtimespec.tv_nsec;
  stamp.changed_sec = info.st_ctimespec.tv_sec; stamp.changed_nsec = info.st_ctimespec.tv_nsec;
#else
  stamp.modified_sec = info.st_mtim.tv_sec; stamp.modified_nsec = info.st_mtim.tv_nsec;
  stamp.changed_sec = info.st_ctim.tv_sec; stamp.changed_nsec = info.st_ctim.tv_nsec;
#endif
  return stamp;
}
Status CheckActivation(const std::string& dir, const std::string& hash,
                       const std::string& name, bool grandfathered, Activation* out) {
  if (!out || !BundleName(name)) return Failure(hash, "invalid activation arguments.");
  Activation passed;
  passed.bundle = StampFile(dir + "/" + name);
  if (!passed.bundle.regular) return Failure(hash, "not found.");
  const auto state = ReadText(dir, &passed.record_text);
  if (state == Record::State::kAbsent && grandfathered && !HasRecordFile(dir)) {
    passed.basis = Activation::Basis::kGrandfathered;
  } else if (state == Record::State::kLegacy) {
    passed.basis = Activation::Basis::kLegacyMarker;
  } else {
    if (state == Record::State::kAbsent) return Failure(hash, "is incomplete.");
    if (state == Record::State::kInvalid) return Failure(hash, "has no valid completion record.");
    const auto record = Parse(passed.record_text);
    if (!Names(record, hash) || !HexDigest(record.bundle_sha256)) return Failure(hash, "completion record mismatch.");
    const auto actual = digest::Sha256File(dir + "/" + name);
    if (actual.empty() || actual != Lower(record.bundle_sha256)) return Failure(hash, "bundle digest mismatch.");
  }
  if (!Unchanged(dir, name, grandfathered, passed)) return Failure(hash, "changed while being verified.");
  *out = passed;
  return Status::Ok();
}
bool Unchanged(const std::string& dir, const std::string& name,
               bool grandfathered, const Activation& passed) {
  if (!BundleName(name)) return false;
  const auto stamp = StampFile(dir + "/" + name);
  if (!stamp.regular || stamp != passed.bundle) return false;
  std::string text;
  const auto state = ReadText(dir, &text);
  switch (passed.basis) {
    case Activation::Basis::kGrandfathered: return grandfathered && state == Record::State::kAbsent && !HasRecordFile(dir);
    case Activation::Basis::kLegacyMarker: return state == Record::State::kLegacy;
    case Activation::Basis::kDigest: return state == Record::State::kPresent && text == passed.record_text;
  }
  return false;
}
}
}
