# scripts/
> L2 | 父级: ../CLAUDE.md

成员清单
create-tvos-host.js: 以独立 SDK 仓库根生成隔离 RN-tvos 宿主，物理复制当前源码，JS 只渲染和确认健康。
drive-tvos-runtime.py: 独占 AppleTV 模拟器验证原生 OTA 与清缓存恢复，只删除该测试 app 的 Caches/rctpakta，保持 defaults 原字节。
test-tvos-runtime.py: 九项输入、路径、清理、身份和真实 HTTP 门卫回归，不代表设备运行。
run-harmony-windows-ci.ps1: 在 source/ 物理 checkout 验证显式候选/HAR与外部新工程，顺序跑九项和独立原生场景，保存输入/日志/HAP。
adb_all_emulators.sh: 将参数广播到已连接 Android 模拟器。
start-firebase-emulator.sh: 准备 Functions、启动和探活 Firebase Emulator。
start-firebase-emulator.bat: Windows Firebase Emulator 启动入口。
firebase.json: Firebase Emulator 服务与 Functions/规则路径配置。
database.rules: Realtime Database 测试规则。
firestore.rules: Firestore Emulator 默认拒绝全局读写，只对指定测试集合开放；不用于生产权限配置。
firestore.indexes.json: Firestore 测试索引。
storage.rules: Storage 测试规则。
functions/: 冻结依赖的 callable Functions 测试工程。

发布前暂存检查清理 adb_all_emulators.sh 与 firestore.rules 的四处行尾空格，补齐后者的测试边界契约；命令体、权限和发布候选内容未变。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
