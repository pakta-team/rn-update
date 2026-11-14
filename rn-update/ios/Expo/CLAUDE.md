# Expo/
> L2 | 父级: ../CLAUDE.md

Expo Modules Apple 适配层。模块类只提供自动发现身份，React Delegate Handler 在正式包把 bundle 选择统一委托给 RCTPakta.bundleURL，开发支持模式交还 Metro，不复制下载或状态逻辑。

## 成员清单

ExpoPaktaModule.swift: 注册 ExpoPakta 模块名，作为 expo-module.config.json 的 Apple 模块发现入口
ExpoPaktaReactDelegateHandler.swift: 兼容新 bundleURL 与旧 createBridge 两代 Expo 生命周期；正式包委托 RCTPakta，开发包保留 Metro
CLAUDE.md: Expo Apple 适配层的职责、版本兼容分支与成员地图

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
