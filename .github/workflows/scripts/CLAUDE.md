# scripts/
> L2 | 父级: ../CLAUDE.md

CI 辅助脚本层。Shell 处理模拟器与 Firebase 生命周期，tvOS生成器/设备驱动与Windows Harmony入口消费隔离原生宿主，`functions/` 是 callable function 测试夹具；规则/JSON 文件只描述模拟器配置。

## 成员清单

adb_all_emulators.sh: 将单条 adb 命令广播到当前运行的 emulator-* 设备
create-tvos-host.js: 固定RN-tvos0.85.3-3/React19.2.3的真实RCTAppDelegate宿主；自定义plist完整声明包身份、可执行名和版本，Xcode展开目标变量；隔离SDK并断言RN同源，Swift源闭合兼容运行库；base/v1/v2只渲染和健康确认，JS关闭检查/激活，依赖当前CLI生成同epoch Hermes PPK
drive-tvos-runtime.py: 独立创建/回收AppleTV模拟器，原生forceBoot两版本与重启保持、只删simctl指定app的Caches/rctpakta且defaults字节不变、回内置包/重新下载/在线purgeRestore；真实JS探针绑定冷启动ID/PID并截图，结束核exe/base/PPK SHA；构造拒绝也保存最终app的Info.plist/五个身份字段，清理失败也保存失败proof
test-tvos-runtime.py: 九项纯门卫/真实HTTP回归，拒绝非tvOS测试app/缺包版本、链接/越界缓存、输入漂移及清理失败伪绿，并保留构造失败的真实plist/精确异常字段；下载旧JS探针允许目标已提交，激活/保持仍强制健康确认；不替代Apple设备执行
run-harmony-windows-ci.ps1: 固定68ab候选/92bb HAR与source实体checkout，在新hw1116跑原九项后另建hn1116顺序跑healthy/crash all，独立HAP/结果不覆盖九项；healthy新装OHPM、crash严格复用，签名仅入忽略短工程；PlanOnly验证两工程都不存在且不触设备
start-firebase-emulator.sh: 构建 functions 并启动/探活 Auth、Database、Firestore、Functions、Storage emulator
start-firebase-emulator.bat: Windows 等价的 Firebase emulator 启动入口
functions/: Firebase callable function TypeScript 夹具
firebase.json: Emulator 服务、端口与导出配置
database.rules: Realtime Database 规则夹具
firestore.rules: Firestore 规则夹具
firestore.indexes.json: Firestore 索引夹具
storage.rules: Storage 规则夹具

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
