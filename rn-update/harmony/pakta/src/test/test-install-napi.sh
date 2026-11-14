#!/bin/sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname "$0")/../../../.." && pwd)"
BUILD="${BUILD_DIR:-$ROOT/.tmp/harmony-install-tests}"
mkdir -p "$BUILD"
NODE_INCLUDE_DIR="${NODE_INCLUDE_DIR:-/usr/include/node}"
if [ ! -f "$NODE_INCLUDE_DIR/node_api.h" ]; then
  HEADER="$(find /tmp -path '*/node-v18*/include/node/node_api.h' -print -quit 2>/dev/null || true)"
  test -n "$HEADER"
  NODE_INCLUDE_DIR="$(dirname "$HEADER")"
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
