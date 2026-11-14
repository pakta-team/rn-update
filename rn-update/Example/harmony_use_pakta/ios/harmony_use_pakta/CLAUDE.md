# harmony_use_pakta/
> L2 | 父级: ../CLAUDE.md

iOS RN 宿主实现。Debug 由 Metro 提供 bundle，Release 从 main.jsbundle 读取，保持与 Harmony 样例页面同一 JS 入口。

## 成员清单

AppDelegate.h: RCTAppDelegate 类型声明
AppDelegate.mm: RN 启动生命周期与 Debug/Release bundle URL 分流
main.m: UIApplicationMain 进程入口

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
