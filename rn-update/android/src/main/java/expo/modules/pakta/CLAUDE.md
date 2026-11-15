# expo.modules.pakta/
> L2 | 父级: ../../../CLAUDE.md

Expo Modules 适配层。它复用 UpdateContext 的 bundle 决策，正式包通过宿主钩子接入热更并将致命异常交回 RN 默认传播链，使默认 uncaught 原生救援仍可达；开发态保留 Metro 和宿主异常处理，不复制下载或状态逻辑。

## 成员清单

ExpoPaktaModule.kt: 注册 ExpoPakta 模块名称，为 Expo Modules 自动发现提供最小定义
ExpoPaktaPackage.java: 注入 ReactNativeHostHandler；正式包委托 UpdateContext 选 bundle、DefaultJSExceptionHandler 保留原异常传播，避免 Expo 非空 handler 的默认空回调吞掉致命错误；开发态不干预
CLAUDE.md: Expo Android 适配层的职责、依赖方向与成员地图

异常回调不标注 `@Override`：Expo SDK 50 的接口尚无该方法，同名公开方法保留旧宿主编译，在新版接口仍按 JVM 虚分派覆写；不抬高 Expo 最低版本。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
