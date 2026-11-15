# app/
> L2 | 父级: ../CLAUDE.md

Android 测试应用模块。Gradle 脚本声明 React Native/Detox 依赖，src/main 提供宿主，src/androidTest 仅承载 Detox 仪器入口；debug keystore 与资源产物不属于业务契约。

## 成员清单

CLAUDE.md: Android app 模块边界与成员地图
_BUCK: Buck 兼容模板入口
build.gradle: 应用插件、variant、React Native bundle 与 Detox 配置；RNU_ENTRY_FILE 切换 JS 入口，RNU_E2E_CHANNEL/RNU_E2E_PACKAGE_VERSION 参数化真服务 APK 身份
build_defs.bzl: Buck 生成辅助定义
proguard-rules.pro: 测试包压缩保留规则
src/: main/debug/androidTest 源集与资源

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
