# ios/
> L2 | 父级: ../CLAUDE.md

iOS 宿主构建层。Podfile 管理 RN 原生依赖，`AwesomeProject/` 把 Release bundle URL 切换到 Pakta，Debug 仍走 Metro。

## 成员清单

Podfile: CocoaPods 依赖、React Native post_install 与宿主 target
AwesomeProject/: AppDelegate、程序入口及热更新 bundle 选择

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
