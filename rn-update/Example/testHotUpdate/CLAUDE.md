# testHotUpdate/
> L2 | 父级: ../CLAUDE.md

传统 RN 热更新消费端。页面同时暴露 Pakta 更新状态、二维码解析、Sentry 诊断和原生 Pakta 调试命令，Android/iOS 构建入口把生产 bundle 交给 SDK 选择。

## 成员清单

src/: RN 页面与原生方法调试面板
scripts/: 本地 Metro 启动辅助脚本
__tests__/: 页面最小渲染回归
android/: RN Android 构建工程与 bundle 接入
ios/: RN iOS 构建工程与 bundle 接入
index.js: AppRegistry 入口，将 app.json 名称映射到 src/index.tsx
babel.config.js: RN Babel 与生产 Paper 插件配置
metro.config.js: Metro 默认配置与 Sentry 包装
jest.config.js: RN Jest 预设及测试路径过滤
jest.setup.js: 测试环境 window 兼容垫片
app.json: 应用身份与原生工程名称
update.json: iOS/Android appKey 配置
package.json: RN 0.87 消费端依赖与脚本

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
