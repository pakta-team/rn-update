# e2e/
> L2 | 父级: ../CLAUDE.md

Harmony 专用 JavaScript 测试束。`app.tsx` 保持最小可观测 UI，entry 文件只切换 bundle label 或注入诊断/崩溃行为，配置文件与 e2etest 的本地服务协议保持同构。

## 成员清单

app.tsx: 带 testID 的最小更新页面与 UpdateProvider，暴露 hash/lastError、公开 getUpdateMetadata 的原生 rolledBackVersion 及 markSuccess/upToDate 事件供真实状态断言
entry.base.ts: 注册 Harmony e2e 基线 bundle
entry.v1.ts: 注入 full 更新标签后复用基线入口
entry.v2.ts: 注入 ppk diff 更新标签后复用基线入口
entry.v4.ts: 注入 v2-track 更新标签后复用基线入口
entry.diag.ts: 直接探测 RNOH PaktaModule 的 syncNativeConfig/getConstants 能力
entry.crashprobe.ts: 在 native 冷启动检查窗口前制造未捕获 JS 异常
localUpdateConfig.ts: Harmony 本地服务端口、appKey、标签与 endpoint 常量

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
