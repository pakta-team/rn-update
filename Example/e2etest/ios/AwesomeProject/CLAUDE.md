# AwesomeProject/
> L2 | 父级: ../CLAUDE.md

iOS 应用源集。AppDelegate 将 RN bundle 与 RCTPakta 接入启动生命周期，SwiftLinking 仅保证静态 Swift Pod 触发 Swift 链接，不承载业务状态。

## 成员清单

CLAUDE.md: iOS 应用源集边界与成员地图
AppDelegate.h: 应用代理声明与 RN delegate 基类接口
AppDelegate.mm: RN bundle URL、RCTPakta delegate 与应用启动实现
Images.xcassets/: Xcode 图标资源目录（资源不纳入 L3）
Info.plist: 应用标识、权限与 bundle 配置
LaunchScreen.storyboard: 启动屏布局资源
main.m: UIApplicationMain 进程入口
PrivacyInfo.xcprivacy: Apple 隐私清单
SwiftLinking.swift: 静态 Swift Pod 链接标记

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
