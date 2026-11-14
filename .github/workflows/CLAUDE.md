# workflows/
> L2 | 父级: ../CLAUDE.md

CI 编排层。YAML 工作流把 npm/bun 校验、Android/iOS/Harmony E2E、发布和失败邮件串成 job；`scripts/` 仅承载可复用的本地 emulator/helper 实现。

## 成员清单

ci-failure-email.yml: 常规分支失败 run 的 issue 通知与恢复关闭；codex/verify- 验证分支不创建、评论或关闭 issue
cli.yml: master/main/codex验证分支 push 与 CLI 相关 PR 执行静态/单测、精确 Node 18.17 smoke、固定四组 Hermes 编译器与夹具 Hash 验证及 seeded fuzz；接线不代表远端已通过
e2e_android.yml: 先重建四 ABI SO 并发布 SHA256SUMS，设备矩阵下载校验同轮产物；RN077 先以同轮 SO/声明生成显式 tgz，再由生成器与构建前后守卫绑定候选及旧架构，不用源码链接覆盖候选
e2e_harmony.yml: Harmony HAP 构建、安装与 hdc 测试
e2e_ios.yml: iOS 模拟器 core/native 两组更新链路；CLI 输入也触发，Homebrew/ccache/Metro 仅受信 master/main push 的 core 保存 UTC 每日快照，PR/native 只读；已编译 app 保留原生输入精确 key
expo_build.yml: Expo57/RN0.86.3 Android/iOS Release 源码消费编译；隔离本地 SDK 并断言依赖归宿主，prebuild 后编译 Kotlin/Swift/共享核，Apple 显式确认 Expo subspec、bundleURL flag 与 Delegate 注册；不代表设备更新或发布候选
lint.yml: master/main 的 PR/push 与 codex验证分支 push 执行 SDK Biome、TypeScript、Harmony 声明和 Native Spec 一致性检查
publish.yml: 四ABI重建后、上传前以Node24执行禁串/Android verifier正负控；同步Release版本后重建分支显式release构建HAR、校验并以--har执行BuildProfile及新增禁串专项；两分支release:prepare各仅pack一次，同一tgz清单/声明消费后发布前核对SHA-256，保留OIDC/contents与provenance/public/beta权限；复用HAR仍显式校验前版版本，不硬套当前版本专项
test.yml: master/main的PR/push与codex验证分支push递归检出；Android真实JNI/JVM、同轮ReleaseHAR→包消费、共享核/Apple源码/原始ObjC++语法及MacFoundation分层；独立macos-26以RN-tvos0.85.3-3实体消费当前SDK，CocoaPods后Release编译并最终链接tvOS应用，检查RCTPakta符号/Network，不以Podspec测试代替平台编译
scripts/: CI 使用的 emulator、Firebase、callable function 与隔离 tvOS 原生应用生成夹具

本地2026-11-14强制Gradle执行51项真实安装JNI与46项JVM，均通过；Release HAR重建后真实正负控5/5、0 skip，package门禁Node17/17与HAR5/5通过。旧本地HAR因源码漂移确实失败，验证后恢复原HAR与BuildProfile/版本源文件；干净CI必须先构建并取artifact，不假定忽略产物存在。历史prepack/tgz结论及本轮摘要见 ../../rn-update/scripts/CLAUDE.md；Actions未实跑，不等同设备或发布候选验收，未发布，原permissions不变。

SDK-08/09接线本地验证：bun run test:release-guards通过Node47/47（含禁串8项与Android verifier22项）、既有HAR5/5、新增HAR禁串4/4，均0 skip。两份YAML解析、46段run命令经WSL bash -n及脚本路径/产物顺序/旧HAR版本/权限/每分支一次候选pack断言通过；Windows文本管道首次引入CRLF导致语法检查误报，改用LF字节输入后全部通过。旧HAR复用分支保留--version与EXPECTED_HAR_VERSION前版值，checker继续覆盖全部.so禁串；新增专项固定读取当前package版本，故仅接当前HAR路径。不改scripts地图、根文档或原生产物；未执行原生构建、发布候选pack、Actions或发布。

## 2026-11-14 同步收尾：SDK-01/SDK-21

iOS 的 Homebrew/ccache/Metro 三处缓存改由 `../actions/e2e-cache` 管理，key 按 UTC 日、OS、架构和 Xcode scope 收敛；只有 master/main 的 push、e2e-ios job、core 请求同时成立才保存，PR/native/手动及其他分支只恢复。已编译 app 不使用该策略，原生输入精确 key 与无 restore-keys 保持；CLI 源码作为更新制品输入也触发 iOS workflow。

新增 Expo 工作流复用 `Example/expoUsePakta` 版本锁，隔离复制 SDK 源码到消费端再链接，Node 断言 Expo/RN 从宿主解析、关键 SDK 文件与 checkout 一致；不运行根 SDK 的 install/prepack。Android 与 iOS 分别 prebuild 后做 Release 编译，iOS 强制确认 Expo subspec、EXPO_SUPPORTS_BUNDLEURL 和 Delegate 注册，任何构建失败直接失败。Xcode 26.4 与上游同版本 RN0.86.3/Expo57 的 CI 配置一致；本地 RN0.86.3 helper 的最低要求为16.1，未在本机执行 Apple 编译。

本轮本地验证：9份根 workflow 加1份 composite 共10份 YAML 解析，36组事件/分支/job/写入请求组合、精确 app 缓存/CLI 触发/Expo 权限与依赖归属/失败传播契约通过；20段 run 经 WSL `bash -n`、内嵌 Node 经 `node --check` 通过。L3、actions/workflows L2 与父地图已回环检查。仅为 CI 接线与策略验证，不代称 Actions、原生编译、设备完整更新或候选包通过，未触发远程执行、打包或发布。

Expo 追加实跑：`TEMP/pakta-expo-ci-prebuild-h0ekGv/REPORT.md` 记录仓库外含空格路径、隔离 SDK 与只读复用宿主依赖；Linux Node22.23.5、容器禁网下配置加载、Android prebuild、iOS prebuild 均退出0，宿主 RN0.86.3/Expo57.0.22 同源解析，排除根RN0.73.11。生成的 expoUsePakta 工程名、use_expo_modules! 与 Android/iOS staging 渠道通过；保留Windows拒绝iOS、低于支持范围Node18及人工断言误写键名的前轮记录，不累计成额外覆盖。没有 install/pod/Gradle/Xcode 编译，不证明 CI Node24、CocoaPods生成路径或设备更新通过。

## 2026-11-14 远端输入调查与隔离分支接线

GitHub API 实查 `pakta-team/rn-update` 默认 main，main/master 当时均为 b2eba4c7；799条未截断远端树是 SDK 根结构，非本地 monorepo。Actions 已启用且允许全部 action，仅一份 active publish.yml、四次历史 tag 发布成功，没有失败 run；最新 v1.1.4 的 Ubuntu 发布结果不代表当前 dirty 输入。仓库 self-hosted runner 为0，GitHub-hosted 的 macOS/Android 仍须实际调度；完整读回证据见 `TEMP/pakta-actions-investigation-vuwgxij_`，不记录凭据。

六份非发布 workflow（test/lint/cli/Android/iOS/Expo）允许 `codex/verify-*` push，用分支内配置直接执行，绕开新 workflow 尚不存在默认分支时无法 dispatch 的限制。快照只需 SDK、CLI、必需根 .github 与两子模块声明，不依赖 server/admin/legal；发布仍仅由 release published 触发。通知的创建和恢复关闭两 job 均拒绝 `codex/verify-` 分支，不产生第三方通知。Harmony 设备保留真实自托管前提，Windows 需复用本机短路径/DevEco/签名及真实差分步骤，不伪装为 macOS 或用 HAR 检查替代设备。

本轮 `actionlint v1.7.12` 对七份变更 workflow 返回0，86段 run 经 WSL `bash -n` 通过；分支匹配、无 push 发布及两个通知 guard 已校验。还未推送输入、dispatch 或执行本轮远端 run，后续必须以实际 SHA、run/job URL 与产物更新状态。

## 2026-11-14 真实 Actions 首轮补缺

安全 orphan 验证提交 `d170c04522c2a5ebe059c729b04be04bf3e88d7a` 已推 `codex/verify-upstream-sync-20261114`，仅含公开 SDK/CLI/CI 和两份子模块引用，没有本地 monorepo 历史。首轮 lint 与 CLI 七个 job 通过；其它平台存在真实失败，不能沿用历史发布结果。Android SDK setup 旧默认包 `tools` 已在仓库失效，test/Expo 入口显式安装 `platform-tools`；HAR 容器已真实完成构建，但随后验证缺少 Python，验证前补安装 Python3；flow replay 改显式 `bash`，兼容 Windows 检出后脚本的普通文件模式。Mac Foundation 提取缺口及 JDK 25 native-access 修复见 SDK 测试地图。其余失败继续逐项修复，首轮原始 jobs/log 保存在 `TEMP/pakta-platform-validation-20261114`，本段不称矩阵通过。

## 2026-11-15 Apple 编译缺陷与平台门禁补全

首轮 Expo iOS 在 Xcode26.4.1 真正编译 SDK 时发现 ObjC ivar 不能含 C++ brace initializer；私有 holder 修复及原始 Objective-C++ 语法正负控见 SDK Apple 地图，Linux源码job显式安装clang。RN077首轮因未提供候选而失败，现先下载/验证同轮四ABI，生成声明后只pack一个Android用途tgz，写入RNU_SDK_TARBALL/SHA256供生成器安装；后续不再用checkout链接替换候选，构建前及Release后守卫均执行，并保存候选身份。这不是跨平台发布候选或HAR准入。

tvOS新增真实macos-26/Xcode26.4 job：固定RN-tvos0.85.3-3/React19.2.3，独立应用下实体隔离SDK并核对源码/RN归属，生成CocoaPods/Xcode tvOS应用，经arm64 appletvsimulator Release编译、最终链接，核对RCTPakta类符号及Network.framework。它不执行tvOS设备更新；本地首轮安装696包暴露file依赖把SDK开发RN0.73装进嵌套目录，归属守卫确实失败；隔离副本仅删devDependencies后重新安装413包、归属与关键源码守卫、真实RCTPaktaSpec代码生成及预期header路径通过，未删运行/peer依赖。实际Xcode tvOS application/shared scheme生成、Ruby/Node语法及64段Bash、三份workflow actionlint通过，全部Apple Python19/19（含安装131核检查/3删源/10guard/2归零/2编译负控）通过。Mac全量结果须由新SHA远端run另证，不将本地生成成功记作平台编译成功。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
