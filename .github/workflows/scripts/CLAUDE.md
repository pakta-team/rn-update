# scripts/
> L2 | 父级: ../CLAUDE.md

CI 辅助脚本层。Shell 处理模拟器与 Firebase 生命周期，tvOS生成器/设备驱动与Windows Harmony入口消费隔离原生宿主，`functions/` 是 callable function 测试夹具；规则/JSON 文件只描述模拟器配置。

## 成员清单

adb_all_emulators.sh: 将单条 adb 命令广播到当前运行的 emulator-* 设备
create-tvos-host.js: 固定RN-tvos0.85.3-3/React19.2.3的真实RCTAppDelegate宿主；隔离SDK并断言RN同源，Swift源闭合兼容运行库；base/v1/v2只渲染和健康确认，JS关闭检查/激活，依赖当前CLI生成同epoch Hermes PPK
drive-tvos-runtime.py: 独立创建/回收AppleTV模拟器，原生forceBoot两版本与重启保持、只删simctl指定app的Caches/rctpakta且defaults字节不变、回内置包/重新下载/在线purgeRestore；真实JS探针绑定冷启动ID/PID并截图，结束核exe/base/PPK SHA，清理失败也保存失败proof
test-tvos-runtime.py: 七项纯门卫/真实HTTP回归，拒绝非tvOS测试app/缺包版本、链接/越界缓存、输入漂移及清理失败伪绿；真实首次需成功确认，持久启动允许原生省略nil marker；不替代Apple设备执行
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
