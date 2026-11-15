# workflows/
> L2 | 父级: ../CLAUDE.md

CI 编排层。YAML 工作流把 npm/bun 校验、Android/iOS/Harmony E2E、发布和失败邮件串成 job；`scripts/` 仅承载可复用的本地 emulator/helper 实现。

## 成员清单

ci-failure-email.yml: 常规分支失败 run 的 issue 通知与恢复关闭；codex/verify- 验证分支不创建、评论或关闭 issue
cli.yml: master/main/codex验证分支 push 与 CLI 相关 PR 执行静态/单测、精确 Node 18.17 smoke、固定四组 Hermes 编译器与夹具 Hash 验证及 seeded fuzz；接线不代表远端已通过
e2e_android.yml: 同轮四ABI/SHA256SUMS供设备矩阵消费，RN077以同轮SO/声明生成候选并绑定旧架构；两个Release leg在正常core/native Detox后用同一APK、宿主CLI和独立两Hermes PPK追加真坏JS救援，显式允许限定测试目录的hidden证据上传；emulator独立shell均使用绝对workspace路径
e2e_harmony.yml: 保留Mac手动链；Windows仅精确专用分支/dispatch，以唯一runner label和source隔离checkout固定68ab/92bb，hw1116原九项后hn1116顺序healthy/crash原生场景，显式白名单JSON/日志/HAP包含hidden路径并always上传；Git LF/OpenSSL/HTTP1.1仅job进程生效
e2e_ios.yml: iOS core/native两组单worker更新链；native在Detox释放服务后追加真实坏JS崩溃救援、独立同epoch Hermes PPK、无forceBoot修复，限定救援目录显式包含hidden路径并always上传；受信main/master core才写每日内容缓存，app原生精确key不变
expo_build.yml: 保留Expo57/RN0.86.3两平台源码Release编译；独立API36 x86_64设备leg先同run四ABI/types打Android用途候选，再fresh expoprobe完整npm/prebuild/候选全字节守门/Release与真坏JS救援，保存候选、实际APK和项目/设备证据；候选构建脚本变化也触发，不作为跨平台发布候选
lint.yml: master/main 的 PR/push 与 codex验证分支 push 执行 SDK Biome、TypeScript、Harmony 声明和 Native Spec 一致性检查
publish.yml: 四ABI重建后、上传前以Node24执行禁串/Android verifier正负控；同步Release版本后重建分支显式release构建HAR、校验并以--har执行BuildProfile及新增禁串专项；两分支release:prepare各仅pack一次，同一tgz清单/声明消费后发布前核对SHA-256，保留OIDC/contents与provenance/public/beta权限；复用HAR仍显式校验前版版本，不硬套当前版本专项
test.yml: 递归检出后分层执行JNI/JVM、同轮HAR→包消费、共享核/Apple源码/Foundation；Linux常驻Android/iOS/tvOS驱动负控；macos-26固定RN-tvos0.85.3-3真RCTAppDelegate/Release链接后，执行真实JS/原生forceBoot双版本/缓存清理回包与在线purgeRestore，always保存运行证据
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

2026-11-15 Harmony设备full后发现原生快照锁同步重入，修复后Windows workflow及PS入口固定改为df181候选/92bb Release HAR；原b5ed/ee0d离线报告和设备4pass/5fail结果不改写。新输入在含空格物理source夹具的PlanOnly通过，旧候选摘要、旧HAR摘要及旧候选文件三个负控均以预期原因拒绝；PS AST/actionlint通过，不创建真实D:\r\hw1115、不启动runner或设备。新证据位于TEMP/pakta-platform-validation-20261114/harmony-snapshot-deadlock/windows-ci-df181-verification.json；运行时env须同时切换候选路径，最终设备与Actions结果由根平台回执登记。

最终GEB候选补4份发包C++头注释后，Windows两入口固定切为4818/92bb，默认HAR未重建；旧df181记录保留为历史。本机phase wrapper单独使用`harmony-finalcandidate`日志和显式reuse1，复用此前已真实通过的92bb OHPM/HAP输入守门；远程Windows入口仍按全新工程默认刷新依赖，不以复用替代构建。4818的PlanOnly与旧候选拒绝、输入等价证据另写TEMP/pakta-platform-validation-20261114/harmony-finalcandidate，不覆盖前轮。

## 2026-11-14 真实 Actions 首轮补缺

安全 orphan 验证提交 `d170c04522c2a5ebe059c729b04be04bf3e88d7a` 已推 `codex/verify-upstream-sync-20261114`，仅含公开 SDK/CLI/CI 和两份子模块引用，没有本地 monorepo 历史。首轮 lint 与 CLI 七个 job 通过；其它平台存在真实失败，不能沿用历史发布结果。Android SDK setup 旧默认包 `tools` 已在仓库失效，test/Expo 入口显式安装 `platform-tools`；HAR 容器已真实完成构建，但随后验证缺少 Python，验证前补安装 Python3；flow replay 改显式 `bash`，兼容 Windows 检出后脚本的普通文件模式。Mac Foundation 提取缺口及 JDK 25 native-access 修复见 SDK 测试地图。其余失败继续逐项修复，首轮原始 jobs/log 保存在 `TEMP/pakta-platform-validation-20261114`，本段不称矩阵通过。

## 2026-11-15 Apple 编译缺陷与平台门禁补全

首轮 Expo iOS 在 Xcode26.4.1 真正编译 SDK 时发现 ObjC ivar 不能含 C++ brace initializer；私有 holder 修复及原始 Objective-C++ 语法正负控见 SDK Apple 地图，Linux源码job显式安装clang。RN077首轮因未提供候选而失败，现先下载/验证同轮四ABI，生成声明后只pack一个Android用途tgz，写入RNU_SDK_TARBALL/SHA256供生成器安装；后续不再用checkout链接替换候选，构建前及Release后守卫均执行，并保存候选身份。这不是跨平台发布候选或HAR准入。

tvOS新增真实macos-26/Xcode26.4 job：固定RN-tvos0.85.3-3/React19.2.3，独立应用下实体隔离SDK并核对源码/RN归属，生成CocoaPods/Xcode tvOS应用，经arm64 appletvsimulator Release编译、最终链接，核对RCTPakta类符号及Network.framework。它不执行tvOS设备更新；本地首轮安装696包暴露file依赖把SDK开发RN0.73装进嵌套目录，归属守卫确实失败；隔离副本仅删devDependencies后重新安装413包、归属与关键源码守卫、真实RCTPaktaSpec代码生成及预期header路径通过，未删运行/peer依赖。实际Xcode tvOS application/shared scheme生成、Ruby/Node语法及64段Bash、三份workflow actionlint通过，全部Apple Python19/19（含安装131核检查/3删源/10guard/2归零/2编译负控）通过。Mac全量结果须由新SHA远端run另证，不将本地生成成功记作平台编译成功。

## 2026-11-15 4660a4b 第二轮真实结果

安全验证SHA `4660a4b431afe850db63b5ee4aed0ed0a0ad0552` 的 Expo Release 两平台全部成功（run43615231410，iOS job132508709440/Android132508709229），实际Xcode已编译本轮Apple生产修复；同轮lint、C++、Apple源码与Android JNI/JVM通过。Foundation已越过编译但链接缺Status::Ok/Error，现由提取器现取真实工厂为独立TU并链接，Linux提取器9/9通过（其中1项实际独立链接Status工厂）；JS459pass/1fail是guard改holder后静态字符串未同步，已修为实际调用并本地专项12/12通过。tvOS实际编译全部SDK/React源后最终app链接缺RCTSwiftUI的swiftCompatibility56，生成器已加真实Swift宿主源及Swift5/运行库嵌入设置；这只修宿主Swift运行库接线，下一轮仍须最终链接通过。第二轮原始失败保留；Foundation下一轮真实Mac结果、tvOS/iOS设备、HAR验证及Android设备故障继续分别验收，不称矩阵完成。

## 2026-11-15 Android 第二轮入口修复

4660a4b 的四 ABI 构建、RN077 候选安装及旧架构 Release 编译已通过；core/debug 在进入 Gradle 前因 `spawnSync ./gradlew EACCES` 失败，RN077 在模拟器成功启动后因 action shell 从仓库根执行相对 `cd` 失败，尚未运行设备 suite。`run-gradle.js` 的 Unix 分支改由 sh 读取 wrapper，不依赖 Windows 检出丢失的执行位；三个 emulator action 的设备命令及 Metro 失败日志路径均显式使用 GITHUB_WORKSPACE。WSL 实际执行无执行位 wrapper，含空格 cwd、空格与 shell 特殊字面参数及原始退出码23均通过；YAML、三段action Bash语法及五条Detox命令保留校验通过，见 `TEMP/pakta-platform-validation-20261114/android-entry-fix-verification.json`。新的真实设备结果须由后续 run 另证。

## 2026-11-15 Package 第三轮 Ruby 入口修复

b567c1535ac7 的 Release HAR 构建及验证已成功；后继 package-check 在任何规格/pack/声明消费检查前，因 ubuntu-latest 切到 26.04 后没有 Ruby3.2.3 预编译包而失败。setup-ruby 原始错误明确列出 3.2.11 可用，现固定为同系列精确补丁版 3.2.11，保留 CocoaPods1.16.2 与全部包检查步骤。job132528387705 原日志保留；修改仅为工具链入口修复，不回记第三轮 package 已通过，后续新 SHA 仍须实际执行完整 job。

## 2026-11-15 Windows Harmony 临时 runner 入口

Windows job只调度`self-hosted,Windows,X64,pakta-harmony-20261115`，普通upstream验证分支push不触发；Mac job仅处理手动非windows选择，专用push不进入Mac。runner启动环境必须显式提供RNU_HARMONY_SDK_TGZ、RNU_HARMONY_HAR_PATH、RNU_HARMONY_SIGNING_FILE、RNU_HARMONY_PROJECT=D:\r\hw1115、DEVECO_STUDIO_HOME、HDC_PATH/TARGET和Linux RNU_WSL_HDIFF_ROOT；完整候选b5ed与HAR ee0d摘要由job/脚本双固定。WSL CLI路径从实际source checkout转换，不借用主工作树CLI。

job进程以`GIT_CONFIG_COUNT=1`、`GIT_CONFIG_KEY_0=core.autocrlf`、`GIT_CONFIG_VALUE_0=false`固定主树及递归子模块的LF字节，不写用户global。checkout v7源码核对未使用这三个indexed配置键，认证仍走其文件配置/HOME，独占本轮配置位不会覆盖checkout认证键；另验`GIT_CONFIG_PARAMETERS`及命令行配置继续生效。实际Windows Git在隔离global autocrlf=true夹具中递归clone，主树和子模块client.ts都与候选一致（226LF/0CRLF），global/认证include文件逐字节未改，见`TEMP/pakta-platform-validation-20261114/harmony-windows-git-lf-verification.json`。这是专用runner的固定配置，不承担合并任意预存indexed配置项的职责。

PowerShell入口拒绝已有短工程、checkout内签名、非实体文件、错摘要或错checkout；PlanOnly完成只读验证才进入实跑。冻结依赖及codegen后复制公共Harmony工程，外部签名只进入该副本忽略的signing.local.json5；stage/sync/prepare/base/build/diff/check/install/test复用既有摘要与fullFallback=false门卫，日志/输入JSON仅从显式e2e路径上传，不上传短工程或签名。入口不会注册runner、推送或自行触发Actions；新的Windows实际run需另记设备结果。

离线actionlint1.7.12（精确声明两个自托管label）、YAML/PowerShell AST、含空格隔离checkout的PlanOnly、四类输入拒绝及复制行为验证通过；codegen保留，依赖/构建/私有签名不随公共工程复制，已有目标目录拒绝，未创建实际D:\r\hw1115。证据`TEMP/pakta-platform-validation-20261114/harmony-windows-ci-offline.json`，不代称真实runner或设备运行。

同轮iOS native最终1套/1项通过，core最终成功但非首遍全绿：首次bundle-hash通过，local-merge两项在launchApp的beforeEach超过300秒；Detox一次重试后两项通过，iOS跳过Android专属2项，完整job耗时57分钟。日志真实命令为maxWorkers2，覆盖Jest配置的1并使用两台模拟器；下一轮workflow显式maxWorkers1保持所有断言/套件/重试，只降低设备并行度，不把已观察的相关性称为已证明的根因。最终单worker稳定性仍需实际run。原始完整日志与成功/重试摘要保存TEMP/pakta-platform-validation-20261114，不以退出0抹去首遍失败。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

## 2026-11-15 第四轮与 Apple 运行场景接线

冻结937b08baab7f的七workflow共25个实际执行job通过，Harmony Mac条件skip。Harmony首轮job132556969592在Git schannel检出阶段失败，未构建/触设备；同SHA以仅runner进程OpenSSL/HTTP1.1且保留TLS验证重试，job132559594499完整新工程双ABI/CLI差分/两套九项37.641秒通过。一次性runner22自行移除；原失败、retry日志、官方artifact14128697554及候选4818/HAR92bb/HAP28957输入证明均保留，不覆盖本机较早HAP。iOS core单次两套3pass/Android-only2skip，native单次1pass；完整package已越过Ruby入口并成功。这轮tvOS仍只有编译/链接，不含下面新增运行场景。

新tvOS生成器改用RCTAppDelegate和RCTAppDependencyProvider，真实SDK bundleURL进入Hermes RN；JS只负责渲染、成功确认和冷启动探针，checkStrategy/updateStrategy均null。独立simctl驱动以当前CLI构建base/v1/v2，同epoch bytecode后注入内置包，服务端forceBoot驱动两版本与重启保持；随后只删除指定测试app的Library/Caches/rctpakta，证明defaults原字节保留、无更新时回内置包、重新下载及在线原生purgeRestore。新设备在finally中逐项回收，诊断/清理异常都写失败proof，最后核exe/base/PPK未变。iOS native leg在正常Detox后追加共享服务的真坏JS无forceBoot救援，独立证据always上传；Linux常驻Android8/iOS5/tvOS6门卫。

本地tvOS宿主实体安装476包，同源守卫、RN-tvos0.85.3-3真实Metro/Hermes base PPK生成通过；tvOS六门卫在WSL Linux全过0skip，Windows因缺symlink权限的首轮1错误保留，不伪装跨平台通过。iOS五项、Android八项输入负控及变更workflow actionlint通过。以上新增场景尚待下一安全SHA实际Mac/simctl运行，不将编包或静态接线记作设备通过。

## 2026-11-15 原生救援长期流程增量

1263f3048a89已独立冻结并推codex/verify-apple-runtime-20261115，test43675771867/iOS43675771855实际运行，未触Harmony精确分支。该SHA之后的Android流程在RN085/RN077原两组Detox后追加共享run-android-crash-rescue.js，显式原APK/宿主/CLI/设备和fresh证据，always上传；不重建或替换已编译APK。Harmony下一轮使用尚不存在的hw1116/hn1116双短工程，先完整原九项，再隔离healthy/crash all，healthy刷新依赖，crash仅门卫允许时严格复用；每variant归档独立HAP，不覆盖原九项。Git检出LF/OpenSSL/HTTP1.1仅job进程且TLS校验保留，不写global。

该增量PS AST、两份actionlint、31段Bash与原两条Detox保留断言通过；仓外含空格实体source夹具PlanOnly通过，原工程复用/两工程相同/错摘要三个负控按预期拒绝，实际hw1116/hn1116均未创建，零设备命令，未读取签名内容。证据harmony-native-windows-ci-offline.json。SDK另已完成本机healthy56.126秒/crash52.428秒各1pass0skip，但本段只登记CI接线，不把本机结果记为新Actions通过；下一次安全冻结与实际runner需单独登记。

1263真tvOS编译/链接及六门卫通过，实际运行已到base→原生GET→v1 accepted=true→新PID保持v1；随后驱动把正常省略的nil isFirstTime当必需键而KeyError，job132695473612失败，官方artifact14146162845完整保留，不记为整套成功。驱动现只把true当首次且仍要求accepted=true/原生isFirstLoadOK；增加该回归后七门卫Linux全过，并用四个真实探针重放边界。另修宿主Info.plist明确CFBundleShortVersionString/CFBundleVersion，新增app/JS/nativeConfig包版本守卫，避免原Xcode INFOPLIST_KEY设置未产生包版本。后续v2/purge全链仍须新SHA实跑。

新Expo设备leg显式重建四ABI并通过readCandidate逐字节核候选SO=本轮源库，只作为Android用途候选；生成/安装/prebuild/完整安装树断言分步执行，API36 x86_64真实坏JS服务与设备证据独立上传。RN077/Expo调用checkout共享制品门卫前均显式安装checkout e2etest锁定依赖，闭合node-stream-zip解析，不借历史node_modules或NODE_PATH。

1263的iOS native真实坏JS在withheld阶段已通过当前PID退出守门，但随后未匹配到BRICK崩溃报告，job132695473183因此失败；上传又因actions/upload-artifact默认排除hidden目录而没有保存`.e2e-artifacts`证据。现仅对iOS救援、Android两救援/RN077 Detox/已列Metro日志和Harmony显式白名单启用include-hidden-files，不扩大路径或上传签名。该SHA的iOS core与Android两Release普通套件误收Harmony native，后续SDK修正发现边界；旧失败保持原身份。

下一Windows入口固定68abd9ff候选/92bb HAR，原4818设备与Actions证据不改写。含空格source夹具的新PlanOnly通过；两工程同址、旧摘要及旧候选三负控拒绝，四workflow YAML、67段Bash、PS AST及6个限定hidden上传断言通过，实际hw1116/hn1116仍未创建、零设备命令、未启动runner，见TEMP/pakta-platform-validation-20261114/harmony-68ab-and-hidden-evidence-verification.json。68ab只改变Expo生产异常委托及其局部地图/非Expo test源集，HAR和Apple输入逐字节未变，仍须将下一runner环境tgz指向pakta-release-MwKP7x而不能仅换摘要。

tvOS五文件overlay f5cd77994170真实运行结果为lint及test其余七job成功；tvOS最终链接和七门卫通过，但在创建simulator前被app身份门卫拒绝，artifact14147251132的SHA256为3c83f27ae0b8b197d8e7fee0d321e5ce1c364238394c9b79f005c13cde21857c。原证据未包含最终plist，不能断言具体缺键。现为自定义plist补齐标准BundleIdentifier/Executable/Name/PackageType/InfoDictionaryVersion契约，保留固定版本，不改SDK；运行前保存最终plist与五字段并报精确expected/actual，构建后打印最终plist和七项Xcode设置，artifact只新增最终plist精确路径。八门卫含构造失败仍保留真实二进制plist回归；后续仍须以新SHA证实实际应用身份和完整OTA/清缓存恢复。

f4608086c618再验的tvOS真实最终plist已保存：BundleIdentifier/Executable/DTPlatformName正确，两个版本键均不存在，展开buildSettings也没有MARKETING_VERSION/CURRENT_PROJECT_VERSION；链接和九门卫通过，但仍在simctl前按身份门卫失败。官方artifact14147644325的SHA256为7b984ed57d355aabb34089703dd21c623669a9f05103f55deb3d0498d442aa19，原样plist/身份JSON/构建设置均已封存。生成器据此显式设置MARKETING_VERSION=1.0.0/CURRENT_PROJECT_VERSION=1，并让plist引用标准变量；保留最终plist与展开设置打印，待新独立overlay实际证明版本及运行，不把此次诊断当运行成功。下载阶段另已分离旧JS探针与目标提交，activate/persist仍默认严格健康确认，九门卫保留该竞态正负控。

同轮Expo独立设备job132705153751的fresh npm/prebuild与完整候选守门成功，Release Metro阶段缺宿主根babel-preset-expo而失败，未生成APK/未触设备。官方artifact14147229264的SHA256为d461f06fbbed94e7ab5f57cbc18aea7fd36e7f5ac28571890dcc70275cba3a7b，内含该轮Android用途候选347bfec0a4118df7d18084f8be83fcfcc432cacf2f57ca17f37f2ace76b19382，不能改挂本机完整68ab。生成器已显式锁定宿主Babel编译依赖，安装守门执行真实production Android入口/TSX/brick转译；本地12项回归与正常npm安装验证通过，实际Release/设备仍由后续独立overlay另验。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
