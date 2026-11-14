# src/
> L2 | 父级: ../CLAUDE.md

Android 变体源码根。debug 仅承载 Flipper 诊断，main 承载 RN 生命周期，release 以同名空实现保持发布依赖最小化；三者都不参与 Harmony bundle 选择。

## 成员清单

debug/: Debug Flipper 诊断实现
main/: RN Android 宿主 Activity 与 Application
release/: Release 空 Flipper 实现

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
