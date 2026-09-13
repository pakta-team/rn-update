# [INPUT]: 依赖 Android NDK、Android.mk 与 armeabi-v7a/arm64-v8a/x86/x86_64 目标 ABI
# [OUTPUT]: 对外提供 API 21、静态 libc++、体积优化、隐藏符号和四 ABI 的 ndk-build 参数
# [POS]: jni 应用级工具链约束，统一发布二进制兼容下限与产物体积策略
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

APP_PLATFORM := android-21
APP_CFLAGS += -Wno-error=format-security
APP_CFLAGS += -fvisibility=hidden -fvisibility-inlines-hidden
APP_CFLAGS += -ffunction-sections -fdata-sections
APP_CFLAGS += -Oz -fno-unwind-tables -fno-asynchronous-unwind-tables
# -fexceptions (ndk-build defaults to -fno-exceptions): the cpp/ cores allocate
# proportionally to untrusted input, and without exceptions a bad_alloc /
# length_error would std::terminate the process instead of surfacing as a Java
# exception (every JNI entry point catches and rethrows). Unwind tables are
# still emitted for throwing frames.
APP_CPPFLAGS += -std=c++17 -Oz -fexceptions -fno-rtti -fno-unwind-tables -fno-asynchronous-unwind-tables
APP_LDFLAGS += -Wl,--gc-sections -Wl,--exclude-libs,ALL
APP_LDFLAGS += -Wl,--icf=all
APP_BUILD_SCRIPT := Android.mk
APP_ABI := armeabi-v7a arm64-v8a x86 x86_64
APP_STL := c++_static
