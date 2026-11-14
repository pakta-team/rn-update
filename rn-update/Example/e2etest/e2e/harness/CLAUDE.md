# harness/
> L2 | 父级: ../CLAUDE.md

Harmony UI 自动化适配层。HarmonyDriver 将 hdc shell/uitest 输出规范化为可等待的 UI 节点，测试套件只依赖稳定的 id/text/坐标查询，不在驱动层承载更新策略。

## 成员清单

CLAUDE.md: 驱动层职责、设备边界与成员地图
harmony-driver.ts: hdc 设备控制、布局解析、节点查询、点击、带 RNOH 启动稳定窗口的重启与轮询等待原语

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
