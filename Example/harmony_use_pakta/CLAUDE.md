# harmony_use_pakta/
> L2 | 父级: ../CLAUDE.md

RN 0.72 + RNOH 消费端样例。普通 RN 页面验证 Pakta API，`e2e/` 提供 Harmony 更新链路专用 bundle 入口，Harmony 工程负责把 ArkUI/RNOH bundle provider 与 HAR 模块接起来。

## 成员清单

App.tsx: 手工更新页面与 PaktaProvider 装配
TestConsole.js: PaktaModule 原生方法诊断面板
index.js: React Native AppRegistry 入口
e2e/: Harmony 设备更新链路的 base/full/diff bundle 入口与本地端点配置
__tests__/: 页面渲染回归
android/: RN Android 宿主构建工程
ios/: RN iOS 宿主构建工程
harmony/: HarmonyOS Hvigor、ArkTS、C++ 与设备测试工程
.gitignore: 排除 Harmony bundle、资源、.local-sdk 显式候选与 Pakta 本地更新目录
app.json: RN 应用身份与原生包名
update.json: Harmony appKey 配置
babel.config.js: RN 0.72 Babel preset
metro.config.js: Metro resolver/transform 配置
jest.config.js: 消费端 Jest 入口
package.json: RN/RNOH 依赖版本与脚本；rn-update 固定消费 .local-sdk/rn-update.tgz 的显式本地候选，先stage再冻结安装，避免旧 registry 包和 file 根目录引入 SDK 开发依赖
README.md: 样例候选stage、冻结安装、Harmony开发与Release运行步骤，链接跨平台E2E地图

资源、lock、oh_modules 与 build 输出只作为工程输入/产物，不纳入源码地图。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
