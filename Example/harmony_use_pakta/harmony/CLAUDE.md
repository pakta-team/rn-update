# harmony/
> L2 | 父级: ../CLAUDE.md

HarmonyOS 工程根。Hvigor 顶层编排 AppScope/entry，`entry` 再把 RNOH ArkTS UI、Pakta C++ PackageProvider 和设备测试汇合为可安装 HAP。

## 成员清单

hvigorfile.ts: 顶层 appTasks 构建入口；从被忽略的 signing.local.json5 注入本机签名材料，公共配置不持有私钥
entry/: HAP 构建、RNOH 运行时、C++ glue 与设备/单元测试
react_native_openharmony/: react-native codegen-harmony 生成的 ArkTS 类型与 TurboModule 导出（只读生成物）
AppScope/: 应用 bundle、版本与资源入口清单
hvigor/: 工程级 Hvigor 执行与依赖配置
build-profile.json5: 无私钥的 Harmony 产品、API 23 target、API 12 最低兼容与模块 profile；编译 SDK 跟随 DevEco 自带版本，避免固定旧 compileSdkVersion 被新 IDE 拒绝
code-linter.json5: ArkTS/C++ 工程 lint 规则
oh-package.json5: 工程级 OpenHarmony workspace 依赖与 ArkTS 选项
oh-package-lock.json5: ohpm 生成的锁定依赖图（只读生成物）
.gitignore: 隔离 OHPM/Hvigor/CMake 产物及 signing.local.json5、本机证书目录
signing.local.example.json5: 本机签名覆盖模板；复制后填写开发者证书，实际文件永不入库

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
