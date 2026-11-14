# android/
> L2 | 父级: ../CLAUDE.md

Android 宿主构建层。根 Gradle 文件提供 RN 插件版本与 SDK 参数，`app/` 将 `UpdateContext.getBundleUrl` 接入 React Host，并保留旧 Buck 入口供历史验证。

## 成员清单

build.gradle: Android/RN 根插件、compileSdk、NDK 与 Kotlin 版本
settings.gradle: Gradle 工程名、RN settings 插件与 app 包含关系
app/: 应用模块、原生入口与 bundle 选择配置

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
