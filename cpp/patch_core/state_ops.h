/**
 * [INPUT]: 操作码声明由 scripts/contract.json 的 stateOperations 经 generate-contract.js 派生
 * [OUTPUT]: 对外提供稳定且只能追加的 StateOperation 操作码枚举
 * [POS]: patch_core 的跨平台状态命令消费头，连接纯 state_core 与平台持久化桥，不生成状态转换或 IO
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
#pragma once

// Single source of truth for the state-machine operation codes shared across
// the platform glue layers (Android JNI in update_core_android.cpp and
// HarmonyOS NAPI in pakta.cpp). The integer values MUST stay in sync with the
// callers on each platform:
//   - Android:  UpdateContext.java (STATE_OP_* constants)
//   - HarmonyOS: UpdateContext.ts  (StateOperation usage)
// Do not renumber existing entries; only append new ones.

namespace pakta {
namespace state_ops {

enum class StateOperation {
  kSwitchVersion = 1,
  kMarkSuccess = 2,
  kRollback = 3,
  kClearFirstTime = 4,
  kClearRollbackMark = 5,
  kResolveLaunch = 6,
};

}  // namespace state_ops
}  // namespace pakta
