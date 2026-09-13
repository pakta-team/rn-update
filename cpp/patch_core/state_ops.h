/**
 * [INPUT]: 依赖 Android UpdateContext 与 Harmony UpdateContext 共同遵守的整数操作协议
 * [OUTPUT]: 对外提供稳定且只能追加的 StateOperation 操作码枚举
 * [POS]: patch_core 的跨平台状态命令事实源，连接纯 state_core 与各平台持久化桥
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
