# AwesomeProject/
> L2 | 父级: ../CLAUDE.md

iOS RN 宿主实现。AppDelegate 仅在非 Debug 构建向 RCTPakta 请求当前 bundle，其余生命周期交给 RCTAppDelegate。

## 成员清单

AppDelegate.h: 宿主代理公开声明
AppDelegate.mm: RN 启动与 Debug/Release bundle URL 分流
main.m: UIApplicationMain 进程入口

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
