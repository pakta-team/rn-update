# expo.modules.pakta/
> L2 | 父级: ../../../CLAUDE.md

Expo Modules 适配层。它复用 cn.reactnative.modules.update.UpdateContext 的 bundle 决策，正式包通过宿主钩子接入热更，开发支持模式保留 Metro，不复制下载或状态逻辑。

## 成员清单

ExpoPaktaModule.kt: 注册 ExpoPakta 模块名称，为 Expo Modules 自动发现提供最小定义
ExpoPaktaPackage.java: 向 Expo 宿主注入 ReactNativeHostHandler；正式包把 bundle 文件选择委托给 UpdateContext，开发支持模式返回 null
CLAUDE.md: Expo Android 适配层的职责、依赖方向与成员地图

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
