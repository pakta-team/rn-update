# harmony-native/
> L2 | 父级: ../CLAUDE.md

Harmony 原生设备验收层。健康与故障基座分别构建到显式独立短工程，测试不点击 JS 更新按钮；服务端请求、实际下载、进程级故障日志和重启健康状态共同证明原生轮次仍工作，不以旧九项或宿主回放替代。

成员清单
CLAUDE.md: 独立原生验收的职责、证据与依赖方向地图
native-check.test.ts: healthy/crash 单套全流程，先验证非强制不激活，再验证 forceBoot 下载、原生 markSuccess 接受后发出的 forceBootRescue 回执与重启保持；crash 模式额外要求同一存活 PID 的新 JS fatal 先于原生请求

2026-11-15 本机实际验收：固定 SDK4818/HAR92bb，healthy 与 crash 分别 1 套 1 项通过、0 skip（56.126s / 52.428s），独立 HAP834672/cfe4af 已归档；新 PID20264/23631 的 RNOH JS fatal 后同一进程继续原生检查/下载，非强制不激活，强制激活并接受 markSuccess 后重启保持且错误/回滚为空。这证明 Harmony 的 JS 线程失效语义，不是 Android/Apple 进程死亡与 crash hold。原九项 HAP245c、已封存 Jest 和五制品/manifest 均复核未变；首轮误等被同步回执覆盖的瞬态 markSuccess 失败另存 TEMP，改为严格等接受后的 forceBootRescue 并增加缺失负控，不改生产 SDK/HAR/HAP。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
