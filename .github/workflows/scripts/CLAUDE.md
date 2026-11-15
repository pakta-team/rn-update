# scripts/
> L2 | 父级: ../CLAUDE.md

成员清单
create-tvos-host.js: 以独立 SDK 仓库根生成隔离 RN-tvos 宿主，物理复制当前源码，JS 只渲染和确认健康。
drive-tvos-runtime.py: 独占 AppleTV 模拟器验证原生 OTA 与清缓存恢复，只删除测试 app 的 Caches/rctpakta；读盘等待 CFPreferences 清理/恢复提交收敛，不写 defaults。
test-tvos-runtime.py: 十二项输入、路径、清理、身份、真实 HTTP 与持久化门卫；真实临时 plist 验证延迟写入重读、旧版本/回滚残留/丢配置超时和恢复下载双条件，不代表设备运行。
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

公开仓库首轮 tvOS 实跑中，原生 query 和 JS 均已清空版本，驱动 2.28 秒读到 CFPreferences 的旧磁盘 plist 即退出。清理/在线恢复改用既有 90 秒有界等待，保留原版本/回滚清空、实际 GET 和安装条件，另要求配置仍在；新快照记录实际收敛。此变更只修驱动的观察时序，不改 SDK、不强制 flush，不把旧失败追认为成功。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
