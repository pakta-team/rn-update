# ios/
> L2 | 父级: ../CLAUDE.md

iOS 原生适配层。Objective-C++ 主模块承接 React Native 桥与共享 C++ 内核，Swift Expo 模块复用同一能力；podspec 决定两条接入路径的编译与依赖。

## 成员清单

Expo/: `ExpoPaktaModule.swift` 暴露 Expo Modules API，`ExpoPaktaReactDelegateHandler.swift` 接入启动与 bundle 选择生命周期
RCTPakta/: 单编译单元包含 Launch/State/Installer/Orchestrator 内部片段，共享 StepRound 唯一执行器；保留本地锁与 tvOS 窗口，Downloader 独立负责网络字节落盘，详见 scripts/apple-round-map.md
CLAUDE.md: iOS 原生适配层的职责、成员与依赖方向地图
ImportReact.h: 屏蔽 React/React-Core 头路径差异的兼容入口
pakta_build_time.txt: pod 构建阶段写入的 UUID 资源，用于识别二进制包版本（非时间戳）

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
