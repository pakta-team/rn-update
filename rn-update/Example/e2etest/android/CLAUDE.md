# android/
> L2 | 父级: ../CLAUDE.md

Android Detox 宿主工程。Gradle 与 React Native 模板负责构建可安装测试包，app/src 中的少量 Java/Kotlin 只连接宿主生命周期和 Detox；构建缓存、签名材料与 wrapper 二进制不纳入业务地图。

## 成员清单

CLAUDE.md: Android e2etest 宿主边界与成员地图
app/: Android 应用模块与测试源集
build.gradle: 根 Gradle 插件和仓库配置
gradle.properties: 构建参数、并行/缓存开关与真机/模拟器四 ABI 默认验证基线
gradle/: Gradle wrapper 配置（wrapper 二进制不纳入 L3）
gradlew: Gradle wrapper Unix 入口
gradlew.bat: Gradle wrapper Windows 入口（模板文件）
settings.gradle: app 模块、React Native 与 Detox 依赖包含配置

2026-11-14 日志卫生：hs_err_pid35580.log 与 replay_pid35580.log 经核实均未被 Git 跟踪，属于 JVM native malloc 失败的 crash/replay 生成证据；先复制到 TEMP/pakta-t01-recovery-20261114-115634/protected-current 并核对 SHA-256，再从宿主目录删除。逐文件摘要见该 TEMP 根 protected-current-manifest.json，SDK .gitignore 排除 hs_err_pid*.log/replay_pid*.log；不删除 Gradle 构建或设备验收现场，不把日志清理计为构建修复。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
