/**
 * [INPUT]: 依赖原生包版本、buildTime、当前/上一热更版本与首次启动标记
 * [OUTPUT]: 对外提供 State、带启动版本身份校验的成功结果模型及同步、切换、回滚、启动决策函数
 * [POS]: patch_core 的纯状态机，统一三端版本激活与崩溃救援语义，不承担持久化 IO
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
#pragma once

#include <string>

namespace pakta {
namespace state {

struct State {
  std::string package_version;
  std::string build_time;
  std::string current_version;
  std::string last_version;
  bool first_time = false;
  bool first_time_ok = true;
  std::string rolled_back_version;
};

struct BinaryVersionSyncResult {
  State state;
  bool changed = false;
};

struct MarkSuccessResult {
  State state;
  std::string stale_version_to_delete;
  bool accepted = false;
};

struct LaunchDecision {
  State state;
  std::string load_version;
  bool did_rollback = false;
  bool consumed_first_time = false;
};

BinaryVersionSyncResult SyncBinaryVersion(
    const State& state,
    const std::string& package_version,
    const std::string& build_time);

State SwitchVersion(const State& state, const std::string& hash);

MarkSuccessResult MarkSuccess(
    const State& state,
    const std::string& expected_version);

State ClearFirstTime(const State& state);

State ClearRollbackMark(const State& state);

State Rollback(const State& state);

bool ShouldRollbackForBrokenFirstLoad(const State& state);

LaunchDecision ResolveLaunchState(
    const State& state,
    bool ignore_rollback,
    bool consume_first_time_on_launch);

}  // namespace state
}  // namespace pakta
