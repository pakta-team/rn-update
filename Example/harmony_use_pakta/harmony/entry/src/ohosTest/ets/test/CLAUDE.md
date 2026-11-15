# test/
> L2 | 父级: ../CLAUDE.md

设备端测试成员。所有测试共享 abilityDelegator，并以 Hypium 的异步生命周期验证 RNOH 宿主可启动且更新存储边界可写。

## 成员清单

Ability.test.ets: EntryAbility 启动与 filesDir 断言
PaktaIntegration.test.ets: preferences、更新目录和 hash 元数据往返断言
List.test.ets: 设备端测试套装配入口

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
