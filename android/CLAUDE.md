# android/
> L2 | 父级: ../CLAUDE.md

Android 原生库。Gradle 根据 React Native 新旧架构和 Expo 环境选择桥接入口，公共实现集中在 `src/main`，补丁计算通过按 ABI 打包的 `librnupdate.so` 与 JNI 接入。

## 成员清单

jni/: ndk-build 入口、HPatch C 适配及 lzma/HDiffPatch 子模块，生成 Android 共享库
lib/: arm64-v8a、armeabi-v7a、x86、x86_64 四 ABI 的 `librnupdate.so` 预编译发布产物；T27以NDK r28强制全量重建，旧flow四导出消失，24降20定义/架构/对齐及负控通过，hash与命令见 ../scripts/flow-map.md
src/: 双 Manifest、公共 Java/Kotlin 更新实现、Expo 模块，以及 newarch/oldarch 的薄 UpdateModule 适配器
CLAUDE.md: Android 原生模块的职责、成员与架构边界地图
build.gradle: AGP 兼容、Expo 探测、sourceSet 切换（含仅 Expo 编译的宿主异常专项）、原生库打包和构建时间注入；Windows Debug JVM回归前执行WSL真实安装JNI专项，缺JDK/WSL即失败，不以skip放行
proguard.pro: 消费端代码压缩保留规则

`src/main/java/cn.reactnative.modules.update` 承担下载、文件事务、状态串行化、崩溃救援、冷启动检查与 React 重载；架构适配层不得复制这些业务规则。`src/main/java/expo.modules.pakta` 仅将相同能力暴露给 Expo Modules。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
