# .github/
> L2 | 父级: ../CLAUDE.md

仓库自动化边界。工作流只编排 lint、发布、原生端到端和失败通知，脚本目录提供 Firebase Emulator 与 Android 多模拟器辅助；它们消费仓库接口但不反向成为 SDK 运行时依赖。

## 成员清单

workflows/: GitHub Actions 工作流与其自有测试/模拟器脚本
actions/: 仓库内 composite action，封装受信每日内容缓存策略

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
