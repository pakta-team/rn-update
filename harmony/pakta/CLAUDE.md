# pakta/
> L2 | 父级: ../CLAUDE.md

可发布的 HarmonyOS HAR 模块。根入口和 BuildProfile 负责包元数据，src/main 组合 ArkTS/ETS、NAPI/C++ 与模块清单；锁文件属于依赖解析产物，不承载业务语义。

## 成员清单

BuildProfile.ets: 将 HAR 版本、构建模式和 target 元数据统一暴露为常量与默认类，适配 DevEco/Hvigor 两种读取方式
build-profile.json5: 声明 Stage 模式、CMake 外部 native 入口、arm64-v8a/x86_64 交付 ABI 与 default/ohosTest targets
hvigorfile.ts: pakta HAR 的 Hvigor 任务入口，委托 harTasks
index.ets: HAR 公共出口，导出 Package、TurboModule 和 bundle provider
OAT.xml: Harmony 许可证/资源过滤策略配置
oh-package-lock.json5: 依赖锁文件，由包管理器维护，排除 GEB L3
oh-package.json5: pakta HAR 包名、版本、模型和 RNOH 依赖声明
src/: 运行时源、NAPI 桥、模块 Manifest、字符串资源与测试
ts.ts: 兼容旧 RNOH TypeScript 入口，转出 PackageCompat 与 TurboModule
CLAUDE.md: pakta HAR 的交付边界与成员地图

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
