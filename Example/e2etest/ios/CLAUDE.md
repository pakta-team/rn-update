# ios/
> L2 | 父级: ../CLAUDE.md

iOS Detox 宿主工程。Xcode project/Podfile 负责构建与依赖，AwesomeProject 源集提供 AppDelegate、入口和 Swift linker marker；更新逻辑通过 RCTPakta 自动链接进入。

## 成员清单

CLAUDE.md: iOS e2etest 宿主边界与成员地图
.xcode.env: Xcode 环境变量入口
AwesomeProject/: iOS 应用源集
AwesomeProject.xcodeproj/: Xcode 工程描述
AwesomeProject.xcworkspace/: CocoaPods workspace 描述
Podfile: React Native、Detox 与 SDK Pod 依赖声明

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
