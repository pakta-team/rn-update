/**
 * [INPUT]: 无依赖（自包含 constexpr 常量），定义两阶段安装完成记录的 schema 与命名
 * [OUTPUT]: 提供 .pakta-complete 记录名、schema 版本与 staging 后缀常量
 * [POS]: patch_core 的安装完整性头，Java/ArkTS 镜像必须手动保持同步，iOS 直接包含
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
#ifndef PAKTA_PATCH_CORE_INSTALL_RECORD_H_
#define PAKTA_PATCH_CORE_INSTALL_RECORD_H_

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
//   downloaded archive (diagnostics / CDN corruption attribution).
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

}  // namespace install_record
}  // namespace pakta

#endif  // PAKTA_PATCH_CORE_INSTALL_RECORD_H_
