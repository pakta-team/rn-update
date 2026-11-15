# ets/
> L2 | 父级: ../CLAUDE.md

ArkTS 运行时层。页面与 Ability 负责宿主生命周期和 bundle provider 选择，Factory 只负责把 PaktaPackage 投影给 RNOH。

## 成员清单

RNPackagesFactory.ets: RNOH RNPackage 创建函数
entryability/: 默认 Ability 的 RN 页面生命周期
entrybackupability/: 系统备份/恢复扩展回调
pages/: ArkUI 页面与 JS bundle provider 容器
pages/Index.ets: ArkUI 根页面、RNApp 与三路 JS bundle provider
entryability/EntryAbility.ets: 默认 Ability 的 RN 页面路径
entrybackupability/EntryBackupAbility.ets: 系统备份/恢复扩展回调

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
