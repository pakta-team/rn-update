/**
 * [INPUT]: 依赖 native_config/round_engine 与包含方 pakta.cpp 的 NAPI 参数、字符串及错误工具
 * [OUTPUT]: 提供 harmony_round 的 Step/Config/Cancellation/Normalize 内部回调，宿主归一化固定 fixedHost=true
 * [POS]: 被生产入口包含的 Harmony 轮次薄绑定；只校验/转换参数并捕获异常，不执行命令或持有平台状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
#pragma once
#include "native_config.h"
#include "round_engine.h"

namespace harmony_round {
static napi_value Invoke(napi_env env, napi_callback_info info, int operation) {
  try {
    size_t count = 8;
    napi_value args[8] = {};
    if (!GetArgCount(env, info, &count, args)) return nullptr;
    const size_t expected = operation == 0 ? 2 : (operation == 1 || operation == 3) ? 1 : 7;
    if (count != expected) {
      ThrowError(env, "round: invalid arguments");
      return nullptr;
    }
    std::string texts[3];
    for (size_t i = 0; i < (operation == 0 ? 2u : (operation == 1 || operation == 3) ? 1u : 3u); ++i) {
      bool ok = false;
      texts[i] = GetString(env, args[i], &ok);
      if (!ok) return nullptr;
    }
    if (operation == 0) return NewString(env, pakta::updateflow::StepRoundJson(texts[0], texts[1]));
    if (operation == 3) {
      std::string out, error;
      if (!pakta::updateflow::NormalizeConfiguration(texts[0], &out, &error, true)) {
        ThrowError(env, error.c_str());
        return nullptr;
      }
      return NewString(env, out);
    }
    if (operation == 1) {
      const auto gate = pakta::updateflow::ParseRunnableConfig(texts[0]);
      return NewString(env, gate.runnable() ? "" : pakta::updateflow::RunnableConfigJson(texts[0]));
    }
    double numbers[4] = {};
    for (size_t i = 0; i < 4; ++i) {
      if (napi_get_value_double(env, args[i + 3], &numbers[i]) != napi_ok) {
        ThrowError(env, "round: expected generation number");
        return nullptr;
      }
    }
    return NewString(env, pakta::updateflow::HostCancellation(texts[0], texts[1], texts[2],
      numbers[0], numbers[1], numbers[2], numbers[3]));
  } catch (const std::exception& error) {
    ThrowError(env, error.what());
    return nullptr;
  }
}
static napi_value Step(napi_env env, napi_callback_info info) { return Invoke(env, info, 0); }
static napi_value Config(napi_env env, napi_callback_info info) { return Invoke(env, info, 1); }
static napi_value Cancellation(napi_env env, napi_callback_info info) { return Invoke(env, info, 2); }
static napi_value Normalize(napi_env env, napi_callback_info info) { return Invoke(env, info, 3); }
}
