/**
 * [INPUT]: 依赖 flow_json 的显式解析限额、archive_limits 保留路径规则与 patch_core 模型校验
 * [OUTPUT]: 实现 copies/CRC/deletes/HBC 有界解析，失败保持调用方输出不变
 * [POS]: 三端安装共用的不可信 manifest 入口；仅生成计划，不执行复制、删除或补丁 IO
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
#include "patch_manifest.h"

#include <cmath>
#include <unordered_map>
#include <utility>

#include "archive_limits.h"
#include "../update_flow_core/flow_json.h"

namespace pakta {
namespace patch {
namespace {
bool Absent(const flowjson::Value& value) {
  return value.IsUndefined() || value.kind() == flowjson::Value::Kind::Null;
}
Status Invalid(const std::string& reason) {
  return Status::Error("delta manifest: " + reason);
}
}

Status ParsePatchManifest(const std::string& text,
                          const PatchManifestOptions& options,
                          PatchManifest* out,
                          std::string* out_hbc_transform) {
  if (!out) return Invalid("output is required");
  flowjson::ParseLimits limits;
  limits.max_input_bytes = archive_limits::kMaxManifestBytes;
  limits.max_nodes = 4 * archive_limits::kMaxEntries;
  bool ok = false;
  const auto root = flowjson::Parse(text, limits, &ok);
  if (!ok || !root.IsObject()) return Invalid("invalid JSON object or size limits");
  const auto& copies = root.Get("copies");
  const auto& crcs = root.Get("copiesCrc");
  if (!Absent(copies) && !copies.IsObject()) return Invalid("copies is not an object");
  if (!Absent(crcs) && !crcs.IsObject()) return Invalid("copiesCrc is not an object");
  std::unordered_map<std::string, uint32_t> crc_by_target;
  for (const auto& member : crcs.members()) {
    const auto& value = member.second;
    if (Absent(value)) continue;
    if (!value.IsNumber() || !std::isfinite(value.AsNumber()) ||
        value.AsNumber() < 0 || value.AsNumber() > 4294967295.0 ||
        std::floor(value.AsNumber()) != value.AsNumber()) return Invalid("invalid CRC32");
    crc_by_target.emplace(member.first, static_cast<uint32_t>(value.AsNumber()));
  }
  PatchManifest manifest;
  std::unordered_map<std::string, uint32_t> crc_by_source;
  for (const auto& member : copies.members()) {
    if (!Absent(member.second) && !member.second.IsString()) return Invalid("copy source is not a string");
    CopyOperation copy;
    copy.to = member.first;
    copy.from = member.second.IsString() ? member.second.AsString() : "";
    const auto& prefix = options.copy_source_prefix;
    if (!prefix.empty() && copy.from.compare(0, prefix.size(), prefix) == 0) copy.from.erase(0, prefix.size());
    if (copy.from.empty()) copy.from = copy.to;
    const auto crc = crc_by_target.find(copy.to);
    if (crc != crc_by_target.end()) {
      copy.has_expected_crc = true;
      copy.expected_crc = crc->second;
      const auto inserted = crc_by_source.emplace(copy.from, copy.expected_crc);
      if (!inserted.second && inserted.first->second != copy.expected_crc) return Invalid("conflicting copiesCrc");
    }
    manifest.copies.push_back(std::move(copy));
  }
  const auto& deletes = root.Get("deletes");
  if (deletes.IsObject()) {
    for (const auto& member : deletes.members()) manifest.deletes.push_back(member.first);
  } else if (deletes.IsArray()) {
    for (const auto& item : deletes.elements()) {
      if (!item.IsString()) return Invalid("delete is not a string");
      manifest.deletes.push_back(item.AsString());
    }
  } else if (!Absent(deletes)) return Invalid("deletes is not an object or array");
  std::string transform;
  const auto& hbc = root.Get("hbcTransform");
  if (!Absent(hbc)) {
    if (!hbc.IsObject()) return Invalid("hbcTransform is not an object");
    const auto& meta = hbc.Get(options.bundle_patch_entry_name);
    if (!Absent(meta)) {
      if (!meta.IsObject()) return Invalid("hbcTransform entry is not an object");
      if (!out_hbc_transform) return Invalid("hbcTransform output is required");
      transform = flowjson::Stringify(meta);
    }
  }
  const auto status = ValidateManifest(manifest);
  if (!status) return status;
  for (const auto& copy : manifest.copies) {
    if (archive_limits::IsReservedEntryName(copy.from) || archive_limits::IsReservedEntryName(copy.to)) return Invalid("reserved copy path");
  }
  for (const auto& path : manifest.deletes) {
    if (archive_limits::IsReservedEntryName(path)) return Invalid("reserved delete path");
  }
  *out = std::move(manifest);
  if (out_hbc_transform) *out_hbc_transform = std::move(transform);
  return Status::Ok();
}
}
}
