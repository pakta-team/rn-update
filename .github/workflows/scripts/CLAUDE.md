# scripts/
> L2 | 父级: ../CLAUDE.md

CI 辅助脚本层。Shell 处理模拟器与 Firebase 生命周期，tvOS生成器和Windows Harmony入口提供隔离原生消费端，`functions/` 是 callable function 测试夹具；规则/JSON 文件只描述模拟器配置。

## 成员清单

adb_all_emulators.sh: 将单条 adb 命令广播到当前运行的 emulator-* 设备
create-tvos-host.js: 生成固定RN-tvos0.85.3-3/React19.2.3的tvOS应用/Podfile/Xcode工程，SDK副本仅去开发依赖并断言RN同源；宿主Swift源使RCTSwiftUI兼容运行库进入最终app链接，供arm64模拟器真编译
run-harmony-windows-ci.ps1: 固定4818候选/92bb HAR与source实体checkout，在新D:\r\hw1115复制公共工程及外部签名；冻结安装后先跑编排/结果/ZIP三组Node回归，再codegen和共享build/diff/install/test；PlanOnly不复制或触碰设备，日志与输入JSON显式收集
start-firebase-emulator.sh: 构建 functions 并启动/探活 Auth、Database、Firestore、Functions、Storage emulator
start-firebase-emulator.bat: Windows 等价的 Firebase emulator 启动入口
functions/: Firebase callable function TypeScript 夹具
firebase.json: Emulator 服务、端口与导出配置
database.rules: Realtime Database 规则夹具
firestore.rules: Firestore 规则夹具
firestore.indexes.json: Firestore 索引夹具
storage.rules: Storage 规则夹具

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
