#include "install_record.h"
#include "archive_limits.h"
#include "patch_manifest.h"
#include "digest.h"
#include "../update_flow_core/flow_json.h"

#include <algorithm>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <limits>
#include <sstream>
#include <unistd.h>

namespace fs = std::filesystem;
namespace ir = pakta::install_record;
namespace al = pakta::archive_limits;
namespace p = pakta::patch;
int checks = 0;
int failures = 0;
void Check(bool ok, const std::string& label) {
  ++checks;
  if (!ok) { ++failures; std::cerr << "FAIL: " << label << '\n'; }
}
void Put(const fs::path& path, const std::string& text) {
  std::ofstream file(path, std::ios::binary | std::ios::trunc);
  file << text;
  if (!file) throw std::runtime_error("fixture write failed");
}
flowjson::Value Load(const fs::path& path) {
  std::ifstream file(path);
  std::ostringstream text;
  text << file.rdbuf();
  bool ok = false;
  auto value = flowjson::Parse(text.str(), &ok);
  if (!file || !ok) throw std::runtime_error("invalid vector file");
  return value;
}
std::string Replace(std::string value, const std::string& key, const std::string& text) {
  size_t start = 0;
  while ((start = value.find(key, start)) != std::string::npos) {
    value.replace(start, key.size(), text);
    start += text.size();
  }
  return value;
}
int main(int argc, char** argv) {
  if (argc != 2) return 2;
  char pattern[] = "/tmp/pakta-t11-XXXXXX";
  const char* temp = mkdtemp(pattern);
  if (!temp) return 2;
  const fs::path root(temp);
  const fs::path vectors(argv[1]);
  fs::create_directory(root / "abc");
  const std::string dir = (root / "abc").string();
  const std::string name = "index.bundlejs";
  Put(root / "abc" / name, "var a = 1;");
  const auto sha = pakta::digest::Sha256File(dir + "/" + name);
  auto upper = sha;
  std::transform(upper.begin(), upper.end(), upper.begin(), [](char c) { return c >= 'a' && c <= 'f' ? c - 'a' + 'A' : c; });
  const auto records = Load(vectors / "install-record-vectors.json");
  for (const auto& vector : records.Get("vectors").elements()) {
    fs::remove(root / "abc" / ir::kFileName);
    const auto& raw = vector.Get("record");
    if (raw.IsString()) Put(root / "abc" / ir::kFileName, Replace(Replace(raw.AsString(), "@SHA@", sha), "@UPPER@", upper));
    const auto label = vector.Get("name").AsString();
    Check(ir::IsComplete(dir, "abc", name) == vector.Get("complete").AsBool(), label + " presence");
    ir::Activation activation;
    const bool grandfathered = vector.Get("grandfathered").AsBool();
    const auto status = ir::CheckActivation(dir, "abc", name, grandfathered, &activation);
    Check(status.ok == vector.Get("activation").AsBool(), label + " activation: " + status.message);
    if (status) {
      Check(ir::Unchanged(dir, name, grandfathered, activation), label + " unchanged");
      Put(root / "abc" / "replacement", "changed");
      fs::rename(root / "abc" / "replacement", root / "abc" / name);
      Check(!ir::Unchanged(dir, name, grandfathered, activation), label + " changed bundle");
      Put(root / "abc" / name, "var a = 1;");
    }
  }
  Check(ir::Parse(std::string(65537, ' ')).state == ir::Record::State::kInvalid, "record byte cap");
  Check(ir::Parse("{\"extra\":[" + std::string(2048, ' ') + "0]}").state == ir::Record::State::kPresent, "bounded valid record");
  std::string text = "unchanged";
  Check(!ir::Build("abc", "", "", &text) && text == "unchanged", "build empty hash fails atomically");
  Check(!ir::Build("abc", "fake", "", &text), "build rejects weak digest");
  Check(!ir::Build("abc", sha, "", nullptr), "build null output");
  fs::create_directory(root / "xyz.staging");
  const auto staging = (root / "xyz.staging").string();
  Check(!ir::Promote(staging, (root / "xyz").string()), "unsealed promote rejected");
  Check(!ir::Seal(staging, "xyz", name).status, "seal missing bundle");
  Put(root / "xyz.staging" / name, "var a = 1;");
  Check(!ir::Seal(staging, "xyz", name, "", std::string(64, '0')).status, "seal known digest mismatch");
  Check(ir::Seal(staging, "xyz", name, "", sha).status.ok, "seal actual bundle");
  Check(ir::Promote(staging, (root / "xyz").string()).ok, "promote sealed staging");
  ir::Activation passed;
  Check(ir::CheckActivation((root / "xyz").string(), "xyz", name, false, &passed).ok, "activate promoted version");
  Check(!ir::CheckActivation(dir, "abc", "../index.bundlejs", true, &passed), "reject unsafe bundle name");
  Check(!ir::CheckActivation(dir, "abc", name, true, nullptr), "activation null output");
  Put(root / "xyz" / ir::kFileName, "{}");
  Check(!ir::Unchanged((root / "xyz").string(), name, false, passed), "record changes invalidate activation");
  fs::remove(root / "abc" / ir::kFileName);
  fs::create_symlink(root / "missing", root / "abc" / ir::kFileName);
  Check(ir::HasRecordFile(dir), "dangling record counts as present");
  Check(!ir::CheckActivation(dir, "abc", name, true, &passed), "dangling record blocks grandfathering");
  fs::remove(root / "abc" / ir::kFileName);
  fs::create_directory(root / "abc" / ir::kFileName);
  Check(!ir::CheckActivation(dir, "abc", name, true, &passed), "directory record blocks grandfathering");
  fs::remove(root / "abc" / ir::kFileName);
  Check(!ir::Write(dir, ""), "write cannot create legacy marker");
  Check(ir::Seal(dir, "abc", name).status.ok, "seal existing test directory");
  Check(!ir::Promote(dir, (root / "xyz").string()), "promote never overwrites existing destination");
  fs::remove(root / "abc" / ir::kFileName);
  fs::create_directory(root / "abc" / ir::kFileName);
  const auto failed_seal = ir::Seal(dir, "abc", name);
  Check(!failed_seal.status && failed_seal.file_failure, "seal reports record IO failure");
  fs::remove(root / "abc" / ir::kFileName);
  Put(root / "abc" / name, "");
  Check(ir::Seal(dir, "abc", name).status.ok, "zero-byte bundle has a real SHA256");
  Check(ir::CheckActivation(dir, "abc", name, false, &passed).ok, "zero-byte bundle verifies its digest");
  fs::remove(root / "abc" / name);
  Check(!ir::CheckActivation(dir, "abc", name, false, &passed), "missing bundle blocks valid record");
  std::string record_nodes = "{\"extra\":[0";
  for (int i = 0; i < 1024; ++i) record_nodes += ",0";
  Check(ir::Parse(record_nodes + "]}").state == ir::Record::State::kInvalid, "record node cap");

  const auto manifests = Load(vectors / "patch-manifest-vectors.json");
  for (const auto& vector : manifests.Get("vectors").elements()) {
    p::PatchManifest manifest;
    manifest.deletes.push_back("sentinel");
    std::string meta = "sentinel";
    const auto status = p::ParsePatchManifest(vector.Get("text").AsString(), {}, &manifest, &meta);
    Check(status.ok == vector.Get("ok").AsBool(), "manifest vector " + vector.Get("text").AsString());
    if (!status) Check(manifest.deletes == std::vector<std::string>{"sentinel"} && meta == "sentinel", "manifest failure atomicity");
  }
  p::PatchManifest manifest;
  p::PatchManifestOptions options;
  options.copy_source_prefix = "resources/rawfile/";
  options.bundle_patch_entry_name = "bundle.harmony.js.patch";
  std::string meta;
  Check(p::ParsePatchManifest("{\"copies\":{\"a\":\"resources/rawfile/b\"},\"copiesCrc\":{\"a\":0},\"hbcTransform\":{\"bundle.harmony.js.patch\":{}}}", options, &manifest, &meta).ok && manifest.copies[0].from == "b" && manifest.copies[0].has_expected_crc && meta == "{}", "local CRC and Harmony metadata adaptation");
  Check(!p::ParsePatchManifest("{\"hbcTransform\":{\"index.bundlejs.patch\":{}}}", {}, &manifest), "cannot silently discard transform");
  Check(p::ParsePatchManifest("{\"extra\":\"" + std::string(2 * 1024 * 1024, 'x') + "\"}", {}, &manifest).ok, "manifest permits more than default JSON cap");
  Check(!p::ParsePatchManifest(std::string(al::kMaxManifestBytes + 1, ' '), {}, &manifest), "manifest byte cap");
  std::string nodes = "{\"extra\":[0";
  for (int i = 0; i < 80001; ++i) nodes += ",0";
  nodes += "]}";
  Check(!p::ParsePatchManifest(nodes, {}, &manifest), "manifest node cap");
  bool ok = true;
  flowjson::Parse(std::string(1024 * 1024 + 1, ' '), &ok);
  Check(!ok, "default JSON cap unchanged");

  const auto archives = Load(vectors / "archive-limits-vectors.json");
  for (const auto& vector : archives.Get("vectors").elements()) {
    al::EntryAccumulator accumulator(al::kMaxArchiveBytes);
    const auto status = accumulator.Accept(static_cast<long long>(vector.Get("size").AsNumber()), static_cast<long long>(vector.Get("compressed").AsNumber()), vector.Get("symlink").AsBool(), vector.Get("name").AsString());
    Check(status.ok == vector.Get("ok").AsBool(), "archive vector " + vector.Get("name").AsString());
    if (!status) Check(!accumulator.Accept(0, 0, false, "safe"), "archive rejection remains terminal");
  }
  al::EntryAccumulator count(al::kMaxArchiveBytes);
  for (int i = 0; i < al::kMaxEntries; ++i) {
    if (!count.Accept(0, 0, false, "empty")) { Check(false, "count exact limit"); break; }
  }
  Check(count.entries() == al::kMaxEntries && !count.Accept(0, 0, false, "extra"), "entry limit plus one");
  al::EntryAccumulator total(al::kMaxArchiveBytes);
  for (int i = 0; i < 4; ++i) Check(total.Accept(al::kMaxEntryBytes, al::kMaxEntryBytes, false, "large").ok, "total exact cap");
  Check(!total.Accept(1, 1, false, "extra"), "total cap plus one");
  Check(!al::CheckUncompressedSize(0, al::kRatioCheckMinBytes + 1), "unknown archive ratio rejected");
  Check(al::CheckUncompressedSize(std::numeric_limits<long long>::max(), al::kMaxEntryBytes).ok, "ratio multiplication cannot overflow");
  Check(!al::CheckEntryCount(-1), "negative count rejected");
  fs::create_directory(root / "extracted");
  Put(root / "extracted" / "empty", "");
  Check(al::CheckExtractedDirectory((root / "extracted").string(), 100).ok, "extracted regular file");
  fs::create_symlink(root / "abc" / name, root / "extracted" / "link");
  Check(!al::CheckExtractedDirectory((root / "extracted").string(), 100), "extracted symlink rejected");
  fs::remove(root / "extracted" / "link");
  fs::create_directory(root / "extracted" / ".pakta-forged");
  Check(!al::CheckExtractedDirectory((root / "extracted").string(), 100), "extracted reserved directory rejected");
  fs::remove_all(root);
  std::cout << checks << " checks, " << failures << " failures\n";
  return failures ? 1 : 0;
}
