/**
 * [INPUT]: 依赖 libFuzzer 入口与 hbc_transform/hbc_transform_wire 的不可信 __diff.json 解析及字节级变换
 * [OUTPUT]: LLVMFuzzerTestOneInput 对任意 (layout, buffer) 组合驱动 TransformHbcInPlace，崩溃/越界即发现
 * [POS]: patch_core/tests 的模糊测试 harness，验证 HBC 变换对任意输入保持内存安全
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
// libFuzzer harness for the hbcTransform wire parser (untrusted __diff.json
// metadata) and the byte-level transform it drives. Build and run with
//   FUZZ=1 ./scripts/test-patch-core.sh
// (clang -fsanitize=fuzzer,address,undefined). Any crash or sanitizer report
// is a finding.
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "../hbc_transform.h"
#include "../hbc_transform_wire.h"

extern "C" int LLVMFuzzerTestOneInput(const uint8_t* data, size_t size) {
  const std::string json(reinterpret_cast<const char*>(data), size);
  pakta::hbc::HbcTransformMeta meta;
  if (!pakta::hbc::ParseHbcTransformMeta(json, &meta)) {
    return 0;
  }
  std::vector<pakta::hbc::HbcSectionDesc> scratch;
  const pakta::hbc::HbcLayoutDesc layout = pakta::hbc::BuildLayout(meta, &scratch);
  // Drive the accepted layout over the same bytes: the transform must stay
  // in bounds for any (layout, buffer) pair, not only for real bundles.
  std::vector<uint8_t> buffer(data, data + size);
  if (pakta::hbc::TransformHbcInPlace(buffer.data(), buffer.size(), layout, false)) {
    pakta::hbc::TransformHbcInPlace(buffer.data(), buffer.size(), layout, true);
  }
  return 0;
}
