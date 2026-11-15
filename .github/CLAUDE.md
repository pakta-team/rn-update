# .github/
> L2 | 父级: ../CLAUDE.md

公开 SDK 仓库的持续集成与发布边界。工作流直接消费仓库根 SDK，CLI 集成测试另行检出公开仓库，不依赖本机 monorepo 或兄弟目录。当前仅完成同步后的本地静态和脚本门卫验证，历史隔离 Actions 结果不绑定这个独立仓库输入。

成员清单
actionlint.yaml: 声明 Harmony 自托管 runner 的自定义标签，保持工作流静态检查可直接运行。
workflows/: SDK 静态、核心、原生设备、Expo、Harmony 与候选发布编排，含其专用驱动。
actions/: 受信缓存与独立公开 CLI 检出构建的共享 composite action。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
