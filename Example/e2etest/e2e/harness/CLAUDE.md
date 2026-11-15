# harness/
> L2 | 父级: ../CLAUDE.md

Harmony UI 自动化适配层。HarmonyDriver 将 hdc shell/uitest 输出规范化为可等待的 UI 节点，测试套件只依赖稳定的 id/text/坐标查询，不在驱动层承载更新策略。

## 成员清单

CLAUDE.md: 驱动层职责、设备边界与成员地图
harmony-driver.ts: hdc 显式目标设备控制、布局/节点/点击和带 RNOH 稳定窗口的重启轮询；安装复用共享 HDC 成功回执门卫，启动也拒绝 unsuccessfully 与 Fail/Error

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
