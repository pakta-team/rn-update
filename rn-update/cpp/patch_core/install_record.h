/**
 * [INPUT]: 依赖 patch_core.h 的 Status 与标准类型，记录名/schema/staging 常量由 scripts/contract.json 派生
 * [OUTPUT]: 提供 Record、SealResult、Activation/FileStamp，以及记录读写、Seal/Promote、CheckActivation/Unchanged 契约
 * [POS]: 三端安装共享接口；核心提供摘要与文件快照，平台拥有状态锁、祖父身份授权和提交代际
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
#ifndef PAKTA_PATCH_CORE_INSTALL_RECORD_H_
#define PAKTA_PATCH_CORE_INSTALL_RECORD_H_

#include "patch_core.h"

// The completion record every platform writes into a version directory once
// an install fully succeeded, and reads back before trusting that directory.
//
//   <root>/<hash>/.pakta-complete
//   {"schema":1,"versionHash":"<hash>","bundleSha256":"<hex>","artifactSha256":"<hex>"}
//
// - Written by the SDK only (archives may not ship a `.pakta-*` entry), as
//   the LAST step of a two-phase install: unpack/patch into
//   <root>/<hash>.staging, write the record there, then atomically rename
//   the staging directory to <root>/<hash>.
// - versionHash must equal the directory name; bundleSha256 is the digest of
//   the final index.bundlejs (bundle.harmony.js on Harmony) and is
//   re-verified at switchVersion time; artifactSha256 is the digest of the
//   downloaded archive (diagnostics / CDN corruption attribution, optional).
// - bundleSha256 is MANDATORY for schema 1. A writer whose bundle digest is
//   empty or fails must fail the install (staging dropped, no record); a
//   verifier must reject a non-empty record without one (record mismatch),
//   never activate the version unverified.
// - Legacy: an EMPTY file is a completed install written by SDK < 10.53
//   (no digests); it stays trusted for presence, nothing to verify.
//
// Mirrors that cannot include this header MUST stay in sync by hand:
//   - android/.../InstallRecord.java
//   - harmony/pakta/src/main/ets/InstallRecord.ts
// iOS (RCTPakta.mm) includes this header directly.

namespace pakta {
namespace install_record {

constexpr int kSchema = 1;
constexpr const char* kFileName = ".pakta-complete";
constexpr const char* kStagingSuffix = ".staging";

constexpr const char* kReservedPrefix = ".pakta-";
constexpr long long kMaxRecordBytes = 64 * 1024;
using patch::Status;

struct Record {
  enum class State { kAbsent, kInvalid, kLegacy, kPresent };
  State state = State::kAbsent;
  bool current_schema = false;
  std::string version_hash;
  std::string bundle_sha256;
  std::string artifact_sha256;
};

struct SealResult {
  Status status = Status::Ok();
  bool file_failure = false;
};

struct FileStamp {
  bool regular = false;
  uint64_t device = 0;
  uint64_t inode = 0;
  int64_t size = 0;
  int64_t modified_sec = 0;
  int64_t modified_nsec = 0;
  int64_t changed_sec = 0;
  int64_t changed_nsec = 0;
  bool operator==(const FileStamp& other) const;
  bool operator!=(const FileStamp& other) const { return !(*this == other); }
};

struct Activation {
  enum class Basis { kGrandfathered, kLegacyMarker, kDigest };
  Basis basis = Basis::kDigest;
  std::string record_text;
  FileStamp bundle;
};

Record Parse(const std::string& text);
bool Names(const Record& record, const std::string& version_hash);
Record Read(const std::string& version_dir);
bool HasRecordFile(const std::string& version_dir);
Status Build(const std::string& version_hash, const std::string& bundle_sha256,
             const std::string& artifact_sha256, std::string* out);
Status Write(const std::string& dir, const std::string& record_json);
SealResult Seal(const std::string& staging_dir, const std::string& version_hash,
                const std::string& bundle_file_name,
                const std::string& artifact_sha256 = "",
                const std::string& known_bundle_sha256 = "");
Status Promote(const std::string& staging_dir, const std::string& version_dir);
bool IsComplete(const std::string& version_dir, const std::string& version_hash,
                const std::string& bundle_file_name);
std::string RecordedBundleSha256(const std::string& version_dir);
FileStamp StampFile(const std::string& path);
Status CheckActivation(const std::string& version_dir,
                       const std::string& version_hash,
                       const std::string& bundle_file_name, bool grandfathered,
                       Activation* out);
bool Unchanged(const std::string& version_dir,
               const std::string& bundle_file_name, bool grandfathered,
               const Activation& passed);

}  // namespace install_record
}  // namespace pakta

#endif  // PAKTA_PATCH_CORE_INSTALL_RECORD_H_
