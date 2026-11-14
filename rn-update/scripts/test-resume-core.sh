#!/bin/sh
# [INPUT]: 依赖宿主 C++17、resume_plan/flow_json 与本地测试，可传上游向量或 --rpc，SANITIZE 控制消毒
# [OUTPUT]: 在固定 .tmp/resume-core-tests 编译并执行真实续传核，参数原样转交测试程序
# [POS]: scripts 的续传纯核与测试 RPC 编译入口，不执行网络或修改平台下载规则
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
set -eu
ROOT_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$ROOT_DIR/.tmp/resume-core-tests"
mkdir -p "$BUILD_DIR"
FLAGS=""
if [ "${SANITIZE:-0}" = "1" ]; then
  FLAGS="-fsanitize=address,undefined -fno-omit-frame-pointer -g"
fi
c++ -std=c++17 -Wall -Wextra -Werror $FLAGS \
  "$ROOT_DIR/cpp/patch_core/tests/resume_plan_test.cpp" \
  "$ROOT_DIR/cpp/patch_core/resume_plan.cpp" \
  "$ROOT_DIR/cpp/update_flow_core/flow_json.cpp" \
  -o "$BUILD_DIR/resume_plan_test"
"$BUILD_DIR/resume_plan_test" "$@"
