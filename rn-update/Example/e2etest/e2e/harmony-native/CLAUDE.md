# harmony-native/
> L2 | 父级: ../CLAUDE.md

Harmony 原生设备验收层。健康与故障基座分别构建到显式独立短工程，测试不点击 JS 更新按钮；服务端请求、实际下载、进程级故障日志和重启健康状态共同证明原生轮次仍工作，不以旧九项或宿主回放替代。

成员清单
CLAUDE.md: 独立原生验收的职责、证据与依赖方向地图
native-check.test.ts: healthy/crash 单套全流程，先验证非强制不激活，再验证 forceBoot 下载、原生 markSuccess 接受后发出的 forceBootRescue 回执与重启保持；crash 模式额外要求同一存活 PID 的新 JS fatal 先于原生请求

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
