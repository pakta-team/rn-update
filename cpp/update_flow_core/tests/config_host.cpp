/**
 * [INPUT]: 依赖生产 native_config、round_engine 与 flow_json 的归一化、门禁、等价和取消判断
 * [OUTPUT]: 提供 stdin JSON 操作到 stdout JSON 结果的测试进程接口，无效输入或操作以非零退出码拒绝
 * [POS]: update_flow_core 的配置专项宿主；供 TypeScript 回归跨进程调用真实共享核，不复制规则或平台 IO
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
#include <iostream>
#include <iterator>
#include "../native_config.h"
#include "../round_engine.h"

int main() {
  const std::string input((std::istreambuf_iterator<char>(std::cin)), {});
  bool ok = false;
  const auto request = flowjson::Parse(input, &ok);
  if (!ok) return 2;
  const auto op = request.Get("op").AsString();
  const auto& args = request.Get("args");
  flowjson::Value result;
  if (op == "normalize") {
    std::string output, error;
    result = flowjson::Value::Object();
    if (pakta::updateflow::NormalizeConfiguration(args.At(0).AsString(), &output, &error,
                                                !args.At(1).Truthy())) {
      result.Set("value", flowjson::Value::String(output));
    } else {
      result.Set("error", flowjson::Value::String(error));
    }
  } else if (op == "gate") {
    result = flowjson::Value::String(pakta::updateflow::RunnableConfigJson(args.At(0).AsString()));
  } else if (op == "equivalent") {
    result = flowjson::Value::Bool(pakta::updateflow::ConfigsEquivalent(
        args.At(0).AsString(), args.At(1).AsString()));
  } else if (op == "cancel") {
    result = flowjson::Value::String(pakta::updateflow::HostCancellation(
        args.At(0).AsString(), args.At(1).AsString(), args.At(2).AsString(),
        args.At(3).AsNumber(), args.At(4).AsNumber(), args.At(5).AsNumber(), args.At(6).AsNumber()));
  } else return 3;
  std::cout << flowjson::Stringify(result);
}
