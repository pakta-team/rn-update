# e2etest/
> L2 | 父级: ../../CLAUDE.md

RN/Detox 端到端消费端。它把本地更新制品、临时 HTTP 服务、原生宿主和多套 Jest runner 组合成可重复的 full/diff/pdiff、bundle hash、原生冷启动与 HarmonyOS 验证链；任何产物均只服务样例验证，不反向成为 SDK 依赖。

## 成员清单

CLAUDE.md: e2etest 工程的验证边界、入口与依赖方向地图
.detoxrc.js: Detox 设备与模拟器选择配置，复用 scripts 中的 iOS 探测逻辑
android/: Android Detox 宿主与测试源集；构建物和 Gradle 缓存不纳入地图
app.json: RN 应用身份与原生构建元数据
babel.config.js: e2etest 的 Babel 转译入口
biome.json: 样例 TypeScript/JavaScript 格式与静态检查约束
bun.lock: 锁定样例依赖解析结果（机械生成，不承载业务语义）
e2e/: Detox、Harmony 与原生冷启动测试套件及其 runner
index.js: React Native 应用注册入口，加载 src/index.tsx
ios/: iOS Detox 宿主工程与 bundle 入口
jest.config.js: 单元测试 runner 配置，排除端到端套件
jest.setup.js: Jest 环境中的 React Native 全局替身初始化
metro.config.js: Metro resolver、缓存与 monorepo 包边界配置，强制当前工作树 SDK 与宿主 React Native 单例；观察父根时仅放行 SDK src/package.json 和当前宿主，排除其它样例/原生构建树
package.json: e2etest 工程与平台命令；官方 SDK 仅提供安装依赖，真实 JS/native 固定到工作树；harmony:e2e 与独立 harmony:native 入口共用 scripts 的编排/结果/ZIP/原生证据回归，json5 与 node-stream-zip 为锁定的直接开发依赖。
react-native.config.js: 覆盖 RN CLI 的 SDK 依赖根，确保 Gradle/Codegen 不消费 node_modules 中的旧发布包
scripts/: 本地服务、产物准备、平台构建和Node/TS hook编排；真坏JS救援复用明确原生宿主，按宿主Hermes版本隔离制品/服务/故障与重启证据
README.md: 平台命令与 RN077 本地 tgz 生成入口，链接生成/Release/设备分层地图
src/: 样例首屏与更新状态展示
tsconfig.json: 样例 TypeScript 编译边界
tsconfig.node.json: Node 制品脚本与 global hooks 的 Node16 编译边界，由 RN077 生成器连同应用配置复制
update.json: 本地更新服务使用的样例版本描述

RN077 隔离宿主只消费显式本地 tgz，不沿用本工程的工作树 SDK 覆盖；生成器将 Metro/CLI 同时重定位到安装树，闭合 JS/Node 编译输入，并加入候选、双 BuildConfig 与运行时旧桥断言。当前候选的完整 core/native 设备证据与历史 smoke 分开登记，见 [RN077 地图](scripts/rn077-oldarch-map.md) 和 [设备矩阵](e2e/ANDROID_DEVICE_MATRIX.md)。Expo 正常宿主复用相同制品协议，通过显式 --expo 路径和 UI 驱动验证，候选全文件守门与限定网络例外见 [Expo OTA 地图](scripts/expo-ota-map.md)。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
