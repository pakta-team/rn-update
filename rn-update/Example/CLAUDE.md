# Example/
> L2 | 父级: ../CLAUDE.md

消费端验证矩阵，而非 SDK 生产依赖。四个工程覆盖现代 RN、Expo、HarmonyOS 与自动化更新链路，允许平台配置差异留在样例内，禁止反向依赖样例代码。

## 成员清单

CLAUDE.md: 消费端验证矩阵的职责、成员与依赖边界地图
e2etest/: RN 0.85.2 + React 19.2.3 + Detox 的主自动化工程；本地服务生成 full/diff/pdiff 并验证检查、下载、切包和救援
expoUsePakta/: Expo 57 + RN 0.86.3 的 Expo Modules 接入示例
harmony_use_pakta/: RN 0.72.5 的 RNOH/HarmonyOS 示例，含 HAR 消费、E2E bundle 入口与平台工程
testHotUpdate/: RN 0.87.0 的传统 Android/iOS 热更新样例与手工验证界面

样例依赖版本各自锁定，不能用某一 Example 的框架版本推断 SDK 的最低支持范围；支持契约以根 `package.json` peerDependencies 与 README 为准。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
