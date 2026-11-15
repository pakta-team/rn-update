# native/
> L2 | 父级: ../CLAUDE.md

原生冷启动验证层。独立 Jest runner 在 JS 不主动 checkUpdate 的前提下，以服务端 forceBoot 驱动原生编排器完成切包，证明救援路径而不复制生产实现。

## 成员清单

CLAUDE.md: 原生冷启动套件的隔离策略与成员地图
jest.config.js: 原生冷启动专用 Detox runner，复用 e2e 全局 hook
native-check.test.ts: forceBoot、重启和 bundle label 的原生检查验收

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
