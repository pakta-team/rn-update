/**
 * [INPUT]: 依赖 patch_core.h 的 PatchManifest、FileSourcePatchOptions 与 Status，依赖归档条目名称集合
 * [OUTPUT]: 对外提供归档补丁类型、条目分类、ArchivePatchPlan、CopyGroup 及计划构建函数
 * [POS]: patch_core 的无 IO 规划边界，把 full/pdiff/diff 归档语义翻译为文件补丁执行参数
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
#pragma once

#include <string>
#include <vector>

#include "patch_core.h"

namespace pakta {
namespace archive_patch {

enum class ArchivePatchType {
  kFull = 1,
  kPatchFromPackage = 2,
  kPatchFromPpk = 3,
};

enum class EntryAction {
  kSkip = 0,
  kExtract = 1,
};

struct CopyGroup {
  std::string from;
  std::vector<std::string> to_paths;
};

struct ArchivePatchPlan {
  ArchivePatchType type = ArchivePatchType::kFull;
  patch::PatchManifest manifest;
  std::string merge_source_subdir;
  bool enable_merge = false;
};

EntryAction ClassifyEntry(
    ArchivePatchType type,
    const std::string& entry_name);

// Convert a platform-supplied integer to an ArchivePatchType. Returns false for
// unknown values so callers can fail loudly instead of silently treating an
// incremental patch as a full package (which would skip validation).
bool TryParseArchivePatchType(int value, ArchivePatchType* out);

patch::Status BuildArchivePatchPlan(
    ArchivePatchType type,
    const patch::PatchManifest& manifest,
    const std::vector<std::string>& entry_names,
    ArchivePatchPlan* out_plan,
    const std::string& bundle_patch_entry_name = "index.bundlejs.patch");

patch::Status BuildCopyGroups(
    const patch::PatchManifest& manifest,
    std::vector<CopyGroup>* out_groups);

patch::Status BuildFileSourcePatchOptions(
    const ArchivePatchPlan& plan,
    const std::string& source_root,
    const std::string& target_root,
    const std::string& origin_bundle_path,
    const std::string& bundle_patch_path,
    const std::string& bundle_output_path,
    patch::FileSourcePatchOptions* out_options);

}  // namespace archive_patch
}  // namespace pakta
