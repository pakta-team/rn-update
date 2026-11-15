# rn-update - 独立发布的多端热更新 SDK

React Native >=0.59 + React >=16.8 + TypeScript ^7.0.2 + C++17 + Java/Kotlin + Objective-C++/Swift + ArkTS；开发基线 React Native 0.73、React 18.2。

React Native 热更新客户端 SDK。公开 API 从 `src/index.ts` 收口，JS 层负责交互式检查与状态编排，各平台原生层负责安装、切包、冷启动检查和崩溃救援，共享 C++ 层提供补丁与无 IO 决策内核。

## 成员清单

.github/: lint、单测、发布及 Android/iOS/Harmony E2E 的 CI 工作流与 Firebase 测试夹具
android/: Android Library；Java/Kotlin 桥接新旧架构，并通过预编译 ABI 库接入补丁内核
cpp/: 跨 Android/iOS/Harmony 复用的补丁执行、Hermes 字节码变换和更新流决策核心
Example/: RN、Expo、HarmonyOS 与 Detox 的可运行消费端和本地更新链路
harmony/: HarmonyOS HAR 模块、RNOH TurboModule 适配、构建包装与声明文件
ios/: Objective-C++ RCTPakta 与 Swift Expo Modules 适配，调用共享 C++ 内核
scripts/: 发布前校验、T08 本地常量派生、T09 桥绑定派生与四端只读校验、原生构建及共享测试入口
src/: npm 公共 API、更新应用服务、React Provider、纯决策逻辑与跨平台桥接适配
CLAUDE.md: 独立 SDK 项目宪法、成员与跨平台依赖方向的语义地图
RELEASE_SYNC.md: 本轮同步来源、独立仓库取舍与本地发版验证边界
.gitignore: 排除本地 Sentry/MCP/Agent 配置、CI CLI 检出、平台构建物、声明 dist 与缓存，保留共享 CLAUDE 地图；已跟踪文件须显式删除，忽略规则不自动取消跟踪
.gitattributes: 强制 Bash 脚本以 LF 检出，阻断 Windows autocrlf 把回车注入路径与参数
.gitmodules: `android/jni/lzma` 与 `android/jni/HDiffPatch` 原生依赖声明
.npmignore: npm 发布排除规则
babel.config.js: React Native Babel 预设入口
biome.json: TypeScript/TSX 静态检查与格式约束
bun.lock: Bun 解析后的精确依赖锁
BUNDLEHASH_MIGRATION.md: bundle hash 迁移的兼容性设计与执行记录
bunfig.toml: Bun 安装与测试行为配置
domains.json: 默认业务域名清单，当前只保留 pakta.yoghourt.space
endpoints.json: SDK 默认服务端端点清单，独立仓库维护自身副本
expo-module.config.json: Expo Apple/Android 原生模块注册表
app.plugin.js: Expo Config Plugin 入口（CommonJS，不经编译的裸 TS 例外），把 channel 固化进 Info.plist 与 Manifest meta-data；appKey/server 留在 JS 侧防配置双源
check-expo-version.js: npm postinstall 安装钩子（CommonJS），消费者安装时探测宿主 Expo：无 Expo 或 SDK < 50 则移除 expo-module.config.json 禁用 Expo 自动链接；以 __dirname 是否含 node_modules 段区分开发期与安装副本，修复上游 npm_package_name 守卫反转成永久空操作的缺陷
LICENSE: MIT 授权正文，署名 Yoghourt Technology(BeiJing) Company Limited 并保留已有上游版权声明
NATIVE_CHECK_FOLLOWUPS.md: 原生冷启动检查后续事项与验证记录
NATIVE_CHECKUPDATE_DESIGN.md: 原生检查、救砖与激活协议的设计事实源
package.json: main/Codegen保留src、types指向dist/types；files排除HDiff开发工程但保留解码编译闭包；常规test串联contract、test:rn077-generator与SDK回归，test:apple-source以-B运行全部Apple Python；prepack在子模块/lint后编译声明，test:pack消费真实tarball；release:prepare同一tgz执行清单/消费/摘要闸门，不发布；test:release-guards运行候选/源码闭包、禁串与Android verifier测试，再以-B和显式--har harmony/pakta.har -v执行既有HAR及新增禁串正负控，要求当前源码同版本Release产物，缺失/漂移不skip
rn-update.podspec: CocoaPods 源文件、依赖、Expo 条件接入与 C++ 编译配置；源码标签与公开仓库 v 前缀对齐，隐私声明由 PaktaPrivacy 资源包交付
react-native.config.js: React Native CLI 自动链接配置入口
README-CN.md: 与英文入口对齐的中文热更新指南，首屏与选型章节覆盖 React Native/Expo OTA、CodePush 替代和费用对比，保留原生迁移、更新策略与恢复边界
readme-banner.svg: README 共用的 SVG 流程横幅，内嵌 admin-web/public/pakta-logo.webp 原始字节并对齐前端暖纸/墨黑/信号橙主题；无运行时外链，随 npm 包分发
README.md: GitHub/npm 英文产品入口，按能力概览、CodePush/Expo 选型、原生接入、最小初始化与折叠进阶配置组织；迁移与费用链接指向官网，CLI 链接指向独立仓库
tsconfig.json: 继承 RN TypeScript 配置，排除原生、Example 与 dist，防声明产物反向进入源码检查
tsconfig.build.json: 继承 SDK 配置，仅将 src 非测试 TS/TSX 编译为 dist/types 声明，不输出 JS/map、不携带 Bun 测试环境或源码注释

## 依赖方向

`src` 只通过桥接契约调用 `android`、`ios`、`harmony`；三端原生实现共同复用 `cpp` 的错误码、补丁与决策语义。`scripts` 和 `Example` 验证这些边界，但不得成为生产代码依赖。

T08 以 scripts/contract.json 为常量事实入口，生成器只拥有跨语言声明分区；生命周期只记录平台现状，T12 在旧布局统一 reset/二进制/渠道的选择性清理，不换库或 schema，保护安装级数据。T09 独立从 src/NativePakta.ts 派生旧架构 Java Spec 与 Harmony 方法表，校验四端方法签名与委托；业务实现、静态 JNI、磁盘协议和副作用所有者不变。client.ts 仍拥有公开状态与装配边界，六个职责模块通过门面协作。

T10 消费验证使用独立临时目录中的候选包，不借用 SDK 源码；第三方依赖复用本地安装。当前 RN 0.73 与 @types/react 19 的上游 JSX 声明不兼容，消费配置沿用 RN 的 skipLibCheck，并额外逐个检查 SDK 声明的相对依赖闭包。该验证不是原生重编译或跨版本兼容矩阵。

T11 安装记录/Seal/Promote/Activation 与 manifest/archive 共享核已接 Android 独立 JNI；InstallRecord/DownloadTask/UpdateContext 在既有锁序内消费真实快照并复核双代际，保留 .pakta-complete/schema1/强摘要/零字节 marker 和旧布局。先负控，Gradle分层87项与四ABI全量更新/23符号verify；不改AndroidRound/flow核心/Harmony/Apple，设备仍待验。文件契约及分层证据见 scripts/install-map.md。

T13 续传半部将请求规划、响应分类和 sidecar 生成收口到 cpp/patch_core/resume_plan，经 JNI/NAPI 和 Objective-C++ 接入三端下载器；平台继续拥有 HTTPS 现有防线、下载总预算与文件 IO，不修改 UpdateContext/轮次/contract.json。Android 收尾已对齐 copier 双 map 接口，Gradle Debug Java 与 39 项 JVM 回归通过，NDK r28 四 ABI 全量重建并同步 android/lib、默认 verify 通过；hash 与设备/其他平台未验边界见 scripts/resume-map.md，不代表全端发布可用。

T13 配置/T14 纯核已迁入冻结上游 native_config/native_round/round_engine，新增 pakta::updateflow 接口并保留旧决策/JNI 命名空间；适配固定宿主 channel、opaque buildTime、bundleStatus 与 Pakta 服务身份。不接平台编排、不迁存储。本轮普通与 ASan/UBSan 各通过既有 111 flow 向量/解析健壮性及新增 688 断言；取消预算专项另行各 47 断言通过，locale 检查跳过；文件契约、默认服务和未验边界见 scripts/flow-map.md。

T15 Android 已将 NativeCheckOrchestrator 的手写轮次收敛为 AndroidRound/DeviceRound 执行共享 StepRound；保留宿主 API、固定 channel、双代际/锁和 HTTPS 防线，不改安装下载器。28条回放先通过，最终Gradle 73项及四ABI全量构建/发布目录verify通过；JNI运行、设备和其他平台待验，见 scripts/android-round-map.md。

T27 删除Android/Harmony无生产消费者的四个旧flow JNI/NAPI包装、声明和注册，保留共享策略核心、新配置/轮次桥和公开API。四ABI强制重建、24降20定义及22项verifier正负控、默认Release HAR双ABI旧注册缺失/链接闸门、强制SDK lint、Gradle分层51+46项及SDK445项通过；不改候选闭包/CI/package，不代表设备或发布验收。最新产物摘要及命令见 scripts/flow-map.md 的T27段，取代早期默认产物状态。

SDK-08/09测试编排增量：根test.yml的Android job及package-check执行禁串/Android verifier两组Node测试，当前HAR构建与下载后均执行test-binary-strings-har.py；publish.yml在四ABI重建后、上传前执行两组Android测试，重建HAR分支在候选前执行新增HAR专项。复用旧HAR仍按前版版本校验，不调用绑定当前SDK版本的HAR专项；原权限与两分支各一次候选pack不变。本地bun run test:release-guards为Node47/47、既有HAR5/5、新HAR禁串4/4，均0 skip；两份YAML解析、46段Bash语法及命令/顺序/旧版本/权限/候选约束通过。仅接线与两份局部地图，不改scripts地图或根文档，不重建原生、不生成发布候选、不发布；Actions与设备未跑。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

## 独立仓库发布边界（2026-11-15）

源码同步自整合提交 `69aac6a8f4f1c7a4b5b910b49940f0203f29699d` 的 SDK 子树；上文 T 系列为源仓库历史分层证据，不代表本次独立检出的重新验收。保留本仓库 `.gitmodules` 和原生依赖提交，删除已退休旧 JNI 桥；发版版本以本仓库 `package.json` 为唯一事实源，仅同步 SDK/Harmony，不读取或改写兄弟 CLI。npm 元数据指向公开仓库根；CI、示例 CLI 输入和本轮验证见 `RELEASE_SYNC.md`。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
