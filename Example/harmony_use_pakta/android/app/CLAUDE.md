# app/
> L2 | 父级: ../CLAUDE.md

Android 应用模块。Gradle 负责 RN/Hermes/Flipper 变体，Java 宿主只提供 React Native 生命周期；Harmony 更新验证实际运行在 `harmony/` 工程。

## 成员清单

build.gradle: applicationId、RN bundling、Hermes/JSC 与 Flipper 依赖
src/: debug/main/release 变体源码与 RN 宿主实现
src/main/java/com/harmony_use_pakta/MainActivity.java: RN Activity 与新架构 delegate
src/main/java/com/harmony_use_pakta/MainApplication.java: ReactNativeHost、自动链接包与 Flipper 初始化
src/debug/java/com/harmony_use_pakta/ReactNativeFlipper.java: Debug Flipper 插件装配
src/release/java/com/harmony_use_pakta/ReactNativeFlipper.java: Release 空 Flipper 实现

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
