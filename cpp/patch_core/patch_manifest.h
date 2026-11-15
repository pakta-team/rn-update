/**
 * [INPUT]: 依赖 patch_core.h 的 Status/PatchManifest 与调用方提供的补丁条目名和资源源前缀
 * [OUTPUT]: 提供 PatchManifestOptions 与 ParsePatchManifest，HBC 元数据独立输出给既有文件补丁接口
 * [POS]: 三端原始 manifest 进入共享补丁模型的解析边界，不承担文件 IO 或平台资源复制
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
#pragma once

#include "patch_core.h"

namespace pakta {
namespace patch {

struct PatchManifestOptions {
  std::string bundle_patch_entry_name = "index.bundlejs.patch";
  std::string copy_source_prefix;
};

Status ParsePatchManifest(const std::string& text,
                          const PatchManifestOptions& options,
                          PatchManifest* out,
                          std::string* out_hbc_transform = nullptr);

}
}
