# src/
> L2 | 父级: ../CLAUDE.md

Android app 源集分层。main 保存生产宿主入口，androidTest 只保存 Detox 测试桥，debug/res 是构建配置与资源边界；业务更新行为由 SDK 原生模块提供。

## 成员清单

CLAUDE.md: Android app 源集拓扑与成员地图
androidTest/: Detox 仪器测试源集
debug/: Debug Manifest 与调试配置
main/: 应用宿主、Manifest 与资源

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
