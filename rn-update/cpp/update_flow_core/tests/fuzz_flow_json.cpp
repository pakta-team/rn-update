/**
 * [INPUT]: 依赖 libFuzzer 入口与 flow_json 解析器、update_flow_core 决策管线（消费原始服务端字节）
 * [OUTPUT]: LLVMFuzzerTestOneInput 验证 Parse/Stringify 往返封闭与 HandleCheckResponse/IsValidCheckResponse 的崩溃安全
 * [POS]: update_flow_core/tests 的模糊测试 harness，守护 JSON 解析与决策管线对任意输入不崩溃
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
// libFuzzer harness for the JSON parser and the decision pipeline built on it
// — both consume raw server bytes. Build and run with
//   FUZZ=1 ./scripts/test-update-flow-core.sh
// (clang -fsanitize=fuzzer,address,undefined). Any crash, sanitizer report or
// abort() below is a finding.
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <string>

#include "../flow_json.h"
#include "../update_flow_core.h"

extern "C" int LLVMFuzzerTestOneInput(const uint8_t* data, size_t size) {
  const std::string text(reinterpret_cast<const char*>(data), size);

  bool ok = false;
  const flowjson::Value parsed = flowjson::Parse(text, &ok);
  if (ok) {
    // Whatever parses must stringify to something that parses again: the
    // canonical serialization is what every vector comparison relies on.
    // Stringify can legitimately emit more bytes than it consumed (raw
    // control bytes become \u00xx, "1e308" prints through %.17g), so a
    // serialization that crosses the parser's input cap is not a finding —
    // only a rejection of text within the cap is.
    const std::string again = flowjson::Stringify(parsed);
    if (again.size() <= flowjson::kMaxInputBytes) {
      bool ok_again = false;
      flowjson::Parse(again, &ok_again);
      if (!ok_again) {
        std::abort();
      }
    }
  }

  flowjson::Value identity = flowjson::Value::Object();
  identity.Set("packageVersion", flowjson::Value::String("2.3.4"));
  identity.Set("currentVersion", flowjson::Value::String("cur"));
  identity.Set("uuid", flowjson::Value::String("test1"));
  identity.Set("rolledBackVersion", flowjson::Value::String("bad"));
  flowjson::Stringify(
      updateflow::HandleCheckResponse(text, identity, false, "none"));
  updateflow::IsValidCheckResponse(text);
  return 0;
}
