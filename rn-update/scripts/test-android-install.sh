#!/bin/sh
# [INPUT]: 依赖 Linux C/C++17、JDK17、生产安装 JNI/共享核及 Gradle TEST_CLASSPATH，BUILD_DIR/BUILD_ONLY 控制宿主构建
# [OUTPUT]: 生成宿主 librnupdate.so，并以 -Xcheck:jni 执行六组真实安装回归，缺依赖失败
# [POS]: scripts 的 Android 安装 JNI 宿主验证端口，不证明 Android ABI 或设备运行
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
set -eu
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
BUILD="${BUILD_DIR:-$ROOT/.tmp/android-install-host}"
JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-17-openjdk-amd64}"
mkdir -p "$BUILD"
INCLUDES="-I$ROOT/cpp/patch_core -I$ROOT/android/jni -I$ROOT/android/jni/HDiffPatch -I$ROOT/android/jni/HDiffPatch/libHDiffPatch/HPatch -I$ROOT/android/jni/lzma/C"
for SOURCE in hpatch.c HDiffPatch/libHDiffPatch/HPatch/patch.c HDiffPatch/file_for_patch.c lzma/C/LzmaDec.c lzma/C/Lzma2Dec.c; do
  cc -fPIC $INCLUDES -c "$ROOT/android/jni/$SOURCE" -o "$BUILD/$(basename "$SOURCE").o"
done
c++ -std=c++17 -shared -fPIC -pthread -Wall -Wextra -Werror $INCLUDES \
  -I"$ROOT/cpp/update_flow_core" -I"$JAVA_HOME/include" -I"$JAVA_HOME/include/linux" \
  "$ROOT/android/jni/native_install_jni.cpp" \
  "$ROOT/cpp/patch_core/update_core_android.cpp" "$ROOT/cpp/patch_core/state_core.cpp" \
  "$ROOT/cpp/patch_core/archive_patch_core.cpp" \
  "$ROOT/cpp/patch_core/install_record.cpp" "$ROOT/cpp/patch_core/archive_limits.cpp" \
  "$ROOT/cpp/patch_core/patch_manifest.cpp" "$ROOT/cpp/patch_core/patch_core.cpp" \
  "$ROOT/cpp/patch_core/digest.cpp" "$ROOT/cpp/patch_core/hbc_transform.cpp" \
  "$ROOT/cpp/patch_core/hbc_transform_wire.cpp" "$ROOT/cpp/update_flow_core/flow_json.cpp" \
  "$BUILD"/*.o -o "$BUILD/librnupdate.so"
if [ "${BUILD_ONLY:-0}" != 1 ]; then
  : "${TEST_CLASSPATH:?Provide Gradle production/test classes and dependency jars}"
  "$JAVA_HOME/bin/java" -Xcheck:jni -Djava.library.path="$BUILD" -cp "$TEST_CLASSPATH" \
    org.junit.runner.JUnitCore cn.reactnative.modules.update.InstallRecordTest \
    cn.reactnative.modules.update.SafeZipFileTest cn.reactnative.modules.update.SharedInstallBoundaryTest \
    cn.reactnative.modules.update.SharedInstallNativeTest \
    cn.reactnative.modules.update.BundledResourceCopierTest \
    cn.reactnative.modules.update.InstallCommitTest \
    cn.reactnative.modules.update.FirstLoadTest
fi
