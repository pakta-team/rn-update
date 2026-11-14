#!/bin/sh
# [INPUT]: 依赖宿主 C/C++17、Node NAPI headers 与真实安装/轮次共享核，支持 NODE_INCLUDE_DIR 显式覆盖
# [OUTPUT]: 构建并执行共享核回归，输出供宿主 Node 消费的 install.node；缺失工具链明确失败
# [POS]: Harmony 安装桥宿主构建边界，优先消费当前 Node 安装的 headers，不依赖发行版全局开发包
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
set -eu
ROOT="$(CDPATH= cd -- "$(dirname "$0")/../../../.." && pwd)"
BUILD="${BUILD_DIR:-$ROOT/.tmp/harmony-install-tests}"
mkdir -p "$BUILD"
if [ -z "${NODE_INCLUDE_DIR:-}" ]; then
  NODE_INCLUDE_DIR="$(node -p 'require("node:path").resolve(require("node:path").dirname(process.execPath), "../include/node")')"
  if [ ! -f "$NODE_INCLUDE_DIR/node_api.h" ]; then
    NODE_INCLUDE_DIR=/usr/include/node
  fi
fi
if [ ! -f "$NODE_INCLUDE_DIR/node_api.h" ] && [ "$NODE_INCLUDE_DIR" = /usr/include/node ]; then
  HEADER="$(find /tmp -path '*/node-v18*/include/node/node_api.h' -print -quit 2>/dev/null || true)"
  if [ -n "$HEADER" ]; then NODE_INCLUDE_DIR="$(dirname "$HEADER")"; fi
fi
if [ ! -f "$NODE_INCLUDE_DIR/node_api.h" ]; then
  printf '%s\n' "Node NAPI headers not found: $NODE_INCLUDE_DIR/node_api.h; set NODE_INCLUDE_DIR to the matching Node include directory" >&2
  exit 1
fi
BUILD_DIR="$BUILD/core" sh "$ROOT/scripts/test-install-core.sh"
for SOURCE in hpatch.c HDiffPatch/libHDiffPatch/HPatch/patch.c HDiffPatch/file_for_patch.c lzma/C/LzmaDec.c lzma/C/Lzma2Dec.c; do
  cc -fPIC -I"$ROOT/android/jni" -I"$ROOT/android/jni/HDiffPatch" -I"$ROOT/android/jni/lzma/C" \
    -c "$ROOT/android/jni/$SOURCE" -o "$BUILD/$(basename "$SOURCE").o"
done
c++ -std=c++17 -Wall -Wextra -Werror -shared -fPIC \
  -I"$NODE_INCLUDE_DIR" -I"$ROOT/cpp/patch_core" -I"$ROOT/cpp/update_flow_core" \
  -I"$ROOT/android/jni" -I"$ROOT/android/jni/HDiffPatch" -I"$ROOT/android/jni/lzma/C" \
  "$ROOT/harmony/pakta/src/test/install_napi_host.cpp" \
  "$ROOT/cpp/patch_core/install_record.cpp" "$ROOT/cpp/patch_core/archive_limits.cpp" \
  "$ROOT/cpp/patch_core/patch_manifest.cpp" "$ROOT/cpp/patch_core/patch_core.cpp" \
  "$ROOT/cpp/patch_core/digest.cpp" "$ROOT/cpp/patch_core/hbc_transform.cpp" \
  "$ROOT/cpp/patch_core/hbc_transform_wire.cpp" "$ROOT/cpp/update_flow_core/flow_json.cpp" \
  "$ROOT/cpp/update_flow_core/native_config.cpp" "$ROOT/cpp/update_flow_core/native_round.cpp" \
  "$ROOT/cpp/update_flow_core/round_engine.cpp" "$ROOT/cpp/update_flow_core/update_flow_core.cpp" \
  "$BUILD/"*.o -o "$BUILD/install.node"
