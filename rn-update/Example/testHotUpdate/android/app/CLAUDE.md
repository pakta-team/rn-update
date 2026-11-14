# app/
> L2 | 父级: ../CLAUDE.md

Android 应用模块。Gradle 配置声明 RN/Sentry 打包边界，Kotlin 宿主在创建 React Host 时把热更新 bundle URL 交给 SDK。

## 成员清单

build.gradle: applicationId、构建变体、Hermes/JSC 与 Sentry Gradle 接入
build_defs.bzl: Buck 预编译 aar/jar 目标生成器
_BUCK: 历史 Buck app-code、资源和 binary 目标
src/: Android 主进程源码根与 Kotlin 宿主包
src/main/java/com/awesomeproject/MainActivity.kt: RN Activity 与新架构 delegate
src/main/java/com/awesomeproject/MainApplication.kt: ReactHost 生命周期与 UpdateContext bundle URL 注入

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
