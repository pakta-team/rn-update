# src/
> L2 | 父级: ../CLAUDE.md

样例 UI 层。index.tsx 仅展示当前 bundle、原生 bundleHash、客户端版本、检查/下载/激活动作与测试标识，assets/ 是首屏静态资源；所有更新语义仍由 rn-update 公共 API 提供。

## 成员清单

CLAUDE.md: 样例 UI 边界与成员地图
assets/: 首屏图标与展示资源，不承载可执行更新逻辑
index.tsx: React Native 首屏、UpdateProvider 消费、原生 channel/buildTime/bundleHash 与服务端 bundleStatus 诊断和 Detox testID 入口；默认连接本地 E2E 服务，可由构建入口注入真实 appKey/endpoint

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
