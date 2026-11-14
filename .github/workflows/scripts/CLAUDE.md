# scripts/
> L2 | 父级: ../CLAUDE.md

CI 辅助脚本层。Shell 入口处理 Android 多模拟器命令和 Firebase Emulator 生命周期，`functions/` 是 callable function 测试夹具；规则/JSON 文件只描述模拟器配置。

## 成员清单

adb_all_emulators.sh: 将单条 adb 命令广播到当前运行的 emulator-* 设备
start-firebase-emulator.sh: 构建 functions 并启动/探活 Auth、Database、Firestore、Functions、Storage emulator
start-firebase-emulator.bat: Windows 等价的 Firebase emulator 启动入口
functions/: Firebase callable function TypeScript 夹具
firebase.json: Emulator 服务、端口与导出配置
database.rules: Realtime Database 规则夹具
firestore.rules: Firestore 规则夹具
firestore.indexes.json: Firestore 索引夹具
storage.rules: Storage 规则夹具

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
