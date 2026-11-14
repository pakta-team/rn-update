# oldarch cn.reactnative.modules.update/
> L2 | 父级: ../../../../CLAUDE.md

传统 React Native 桥接叶节点。UpdateModule 继承本地 Spec 派生的抽象桥声明，状态命令与新架构保持统一 Promise 形状，实际行为统一委托 UpdateModuleImpl；保留 markSuccess(expectedHash) 与旧桥 removeListeners(Integer count)。

## 成员清单

NativePaktaSpec.java: T09 从 src/NativePakta.ts 生成的旧架构抽象声明，继承 ReactContextBaseJavaModule，不得手改；常量仍由 UpdateModule 提供
UpdateModule.java: 继承 NativePaktaSpec，暴露旧桥 Pakta API 与常量并委托共享实现，由四端 parity 检查签名和 Promise 委托参数
CLAUDE.md: 旧架构桥接叶节点的职责与成员地图

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
