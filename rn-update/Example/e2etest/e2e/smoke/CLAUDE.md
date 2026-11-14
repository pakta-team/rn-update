# smoke/
> L2 | 父级: ../CLAUDE.md

Debug 启动 smoke 层。它绕过本地制品准备，只验证 Detox 首屏能完成 Native module 常量初始化并渲染 bundle label，避免把启动回归与更新链路混为一谈。

## 成员清单

CLAUDE.md: Debug smoke runner 与测试边界地图
boot.test.ts: Debug 构建首屏启动和 bundle label 可见性验收
jest.config.js: smoke 专用 Detox runner，使用原生 global hooks

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
