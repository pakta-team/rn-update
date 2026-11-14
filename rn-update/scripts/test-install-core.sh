#!/bin/sh
# [INPUT]: 依赖宿主 C/C++17、真实安装/归档/manifest 核、flow_json 与本地向量，BUILD_DIR/SANITIZE 控制产物
# [OUTPUT]: 编译并执行真实文件 IO 安装回归，以非零状态报告失败，不静默跳过
# [POS]: scripts 的安装核验证入口，被 patch-core 与安装桥宿主复用，不拥有安装算法
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
set -eu
ROOT_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
BUILD_DIR="${BUILD_DIR:-$ROOT_DIR/.tmp/install-core-tests}"
mkdir -p "$BUILD_DIR"
FLAGS=""
if [ "${SANITIZE:-0}" = "1" ]; then
  FLAGS="-fsanitize=address,undefined -fno-omit-frame-pointer -g"
fi
INCLUDES="-I$ROOT_DIR/cpp/patch_core -I$ROOT_DIR/cpp -I$ROOT_DIR/android/jni -I$ROOT_DIR/android/jni/HDiffPatch -I$ROOT_DIR/android/jni/HDiffPatch/libHDiffPatch/HPatch -I$ROOT_DIR/android/jni/lzma/C"
for SOURCE in hpatch.c HDiffPatch/libHDiffPatch/HPatch/patch.c HDiffPatch/file_for_patch.c lzma/C/LzmaDec.c lzma/C/Lzma2Dec.c; do
  cc -Wall -Wextra $FLAGS $INCLUDES -c "$ROOT_DIR/android/jni/$SOURCE" -o "$BUILD_DIR/$(basename "$SOURCE").o"
done
c++ -std=c++17 -Wall -Wextra -Werror $FLAGS $INCLUDES \
  "$ROOT_DIR/cpp/patch_core/tests/install_core_test.cpp" \
  "$ROOT_DIR/cpp/patch_core/install_record.cpp" \
  "$ROOT_DIR/cpp/patch_core/archive_limits.cpp" \
  "$ROOT_DIR/cpp/patch_core/patch_manifest.cpp" \
  "$ROOT_DIR/cpp/patch_core/patch_core.cpp" \
  "$ROOT_DIR/cpp/patch_core/digest.cpp" \
  "$ROOT_DIR/cpp/patch_core/hbc_transform.cpp" \
  "$ROOT_DIR/cpp/patch_core/hbc_transform_wire.cpp" \
  "$ROOT_DIR/cpp/update_flow_core/flow_json.cpp" \
  "$BUILD_DIR"/*.o -o "$BUILD_DIR/install_core_test"
"$BUILD_DIR/install_core_test" "$ROOT_DIR/cpp/patch_core/tests"
