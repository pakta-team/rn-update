# scripts/
> L2 | 父级: ../CLAUDE.md

e2etest 构建与编排脚本层。脚本只组合已有 SDK、平台工具和本地服务协议；制品准备、Node/TS hook 编译与 iOS/Harmony 构建的副作用均从测试入口显式触发。

## 成员清单

CLAUDE.md: e2etest 脚本职责、入口与成员地图
assert-local-sdk.js: 在构建/测试前断言 Metro 与 RN CLI 均指向当前工作树 SDK，且扫描只放行运行输入、不遍历其它样例与原生构建树
build-real-service-android.js: 从环境变量生成忽略提交的基线/更新入口，并按 apk/ppk 模式构建网络配置一致、可参数化 channel/packageVersion 且不污染默认 Detox 配置的真服务 Android 制品
build-local-device-android.js: 从局域网 endpoint 生成忽略提交的入口并构建连接本地 E2E server 的 Android Release APK，隔离模拟器的 10.0.2.2 默认值
build-harmony-e2e.sh: 构建并安装 HarmonyOS e2e 基础应用；默认 release buildMode（debug hap 会跳过 markSuccess 导致重启回滚），hvigor 优先使用 DevEco 自带 Node 规避新版 Node 的 fs.rmdirSync 拒绝
run-harmony-e2e.js: Node 跨平台分阶段 Harmony 入口；生成和复用均流式验证 full/patch 的 ZIP 结构、CRC、预算与必需条目，坏包零设备动作拒绝；构建/安装绑定完整 tgz/HAR/JS/glue/base/HAP/显式目标，固定完整 Jest，依赖仅在严格门卫通过后显式复用，不持有签名。
harmony-e2e-sdk.js: 候选输入边界，stage在安装前将完整摘要候选复制到样例忽略的.local-sdk路径，sync物理隔离SDK并逐字节核对生产源码，拒绝根开发依赖与React/RN/RNOH跨树解析；由run-harmony-e2e.js复用。
harmony-e2e-inputs.js: 只读 gzip/TAR 与 OHPM 复用门卫，完整 HAR 文件 SHA256、版本、当前短项目 file:../pakta.har 清单/锁和项目内物理 store 必须一致；拒绝额外/缺失/漂移文件、链接逃逸、TAR 路径别名和损坏，不写工程或静默安装。
harmony-e2e-results.js: helper 与设备驱动共享的 HDC 安装回执门卫，接受传统成功句及 SDK26 路径回执与 AppMod finish 的完整组合，拒绝 unsuccessfully/Fail/Error；验收 Jest 两套当前工程结果和九项必需测试，拒绝空套件、过滤、跳过、缺失和错工程结果。
harmony-e2e-results.test.js: HDC 传统/SDK26 真实回执、缺失完成行与失败混入、伪绿色汇总、缺失/跳过/重复用例及错工程 Jest 结果的持久负控。
run-harmony-native-e2e.js: healthy/crash 独立短工程编排，复用构建/安装身份与固定完整结果门卫，原九项制品/结果不被覆盖，成功后归档实际HAP。
harmony-native-results.js: 原生验收证据门卫，逐运行绑定真实请求/下载、非强制不激活、原生markSuccess接受后回执、forced健康终态及同PID新JS fatal先于原生请求的证据。
harmony-native-results.test.js: 陈旧runId/日志、错PID、缺下载、非强制误激活、错误终态和错套件等确定性正负控，不计作设备通过。
hdc-sdk26-install-output.json: SDK26 真实安装 stdout 两行的 Base64 原字节夹具，保留成功句后的 ASCII 空格与 CRLF 且避免 Git 换行规范化，供共享结果门卫和 helper 安装证明回归使用。
harmony-e2e.test.js: Node 持久正负控，覆盖候选/安装身份、RN 隔离、fallback、显式设备、清理边界、Release、严格 HAR 复用及完整测试证明；复用失败零命令，旧结果和测试中输入漂移不能生成成功证明，不冒充设备验收。
harmony-e2e-map.md: 可供本机和临时 Windows runner 共用的分阶段命令、候选环境变量与证据边界，明确 prepare→base→build→diff 顺序及设备测试串行使用端口。
compile-node-ts.js: 将 TS hook 编译到临时目录并解析 Node 可执行入口
create-rn077-oldarch-project.js: 校验显式本地 tgz 后生成 RN 0.77.3/CLI 15.0.1 宿主；复制完整 JS/Node 编译配置与候选，清除仓库外类型别名、重定位 Metro/CLI 到安装树，拒绝覆盖既有工程
create-expo-e2e-project.js: 只生成fresh Expo57/RN0.86.3宿主，显式候选/摘要与可选源码输入，复用UI/版本/坏JS入口并记录源码摘要；安装、prebuild和Gradle由调用方执行
assert-expo-e2e-project.js: prebuild后核对完整物理候选、Expo/RN/React单源、生成输入、标准ExpoReactHostFactory与仅10.0.2.2网络，不访问设备
expo-e2e-network-plugin.js: 复制到隔离宿主的ConfigPlugin模板，重复prebuild固定Manifest/XML，默认禁明文、仅10.0.2.2例外，拒绝覆盖无关网络策略
expo-e2e-project.test.js: fresh/错摘要/完整候选/第二依赖树/网络扩散/入口注入与插件重复执行的离线正负控，不代称Expo设备执行
jest-runner-boundaries.test.js: 真实Jest --listTests断言普通Detox仅三套、Harmony native仅一套，防止新增平台目录误收集；不执行用例或设备
assert-rn077-oldarch.js: 校验候选摘要、关键安装字节和 JS/native 同根；--release 强制宿主与 SDK BuildConfig 均为旧架构且 APK 存在
rn077-runtime-proof.js: 生成宿主启动前验证 RN077、legacyBridge 与 NativeModules.Pakta 同一对象，拒绝 bridgeless/Turbo/Fabric
rn077-oldarch.test.js: Node 持久正负控，覆盖仓库外含空格 TEMP、候选篡改、双 BuildConfig、运行时架构与复制后的独立Harmony native发现边界；SDK test:rn077-generator 及常规 test 接入
rn077-oldarch-map.md: RN077 生成/候选/Release/设备分层证据与未验边界，明确旧 TEMP smoke 不等于生成器全链通过
detect-ios-simulator-type.js: 选择与 Detox 一致的 iOS 模拟器 runtime
drive-expo-update-ui.py: 显式候选全文件/物理安装守门后，通过 ADB/UI Automator 验证隔离 Expo 宿主两策略四阶段更新与重启，拒绝非 probe/e2e 应用数据清理
expo-ota-map.md: Expo57隔离宿主、候选安装、限定网络例外、共享制品准备与设备驱动的可重现命令和证据边界
generate-platform-diffs-wsl.cjs: 显式 Android/Harmony 拓扑的真实差分生成器；重生前撤销旧 false 证明，全部 full/patch ZIP 门卫通过后才提交 fullFallback=false。
verify-update-artifacts.js: 复用 node-stream-zip 定位中央目录/流式解压，逐条校验 local/central/descriptor、大小、CRC、必需 bundle/patch/__diff.json 与清单形状；沿用 contract.json 归档预算，异步供生成器、独立子进程供同步复用门卫，不解包。
verify-update-artifacts.test.js: TEMP 黄金 ZIP 正控及缺首53字节、目录偏移/尺寸、descriptor、CRC、必需条目、清单形状和解压预算负控；假生成器验证失败保留 fallback=true，不运行真实构建或设备。
zip-artifact-fixtures.js: Python zipfile 冻结的极小 full/patch/deflate-descriptor/非法清单原字节，独立于待测 CLI 写入器，供 Node 门卫与编排回归共用。
crash-rescue-server.js: Android/iOS 真坏 JS 共享 Node HTTP 服务；brick forceBoot，armed/无预下载证据后开放无 forceBoot fix，按阶段记录请求hash、制品HEAD/GET、摘要与封存证据，不伪造 crashRescue。
crash-rescue-server.test.js: 离线 HTTP 状态机正负控，验证 fix 预下载封锁、阶段证据、无 forceBoot 修复及状态持久化，不冒充设备救援。
crash-rescue-map.md: 两平台共享服务阶段、无 forceBoot/无预下载约束、独立 Hermes PPK 构建证明及 Android 驱动参数；明确离线准备不能替代设备 crashRescue 证据。
drive-android-crash-rescue.py: 显式设备/样例 APK 和救援制品摘要守门后，以 ADB/UI 与 fatal 日志确认已 armed 的坏 JS、无 forceBoot 修复、原生 crashRescue=true 和重启保持；不点击 JS 检查或写 SDK 状态。
android-crash-rescue.test.py: 临时APK/PPK与阻断ADB的记录器验证摘要、Hermes版本、旧证据/服务和制品身份门卫；仅离线边界，不计作设备救援。
run-android-crash-rescue.js: 本机/CI单宿主编排入口，验证已有APK和可选制品证明，异步驱动Python时维持自有HTTP服务，最后核输入摘要并关闭服务；与iOS复用准备器/服务协议。
ios-rescue-server.ts: §11 历史 iOS 救砖实验服务；当前分阶段跨平台验收使用 crash-rescue-server.js
drive-ios-crash-rescue.py: 显式Release app/UDID和制品Hermes版本的simctl坏JS验收；当前启动PID退出必须关联原生终止stderr、严格native RCTFatal统一日志或系统异常报告，扫描Retired/当前simulator并始终保留诊断；只读确认armed、无预下载/forceBoot的原生救援与重启，不写状态
ios-crash-rescue.test.py: iOS应用/Release/Hermes、双JSON与旧文本报告、原生stderr和统一日志的PID/应用/时间/类别负控，拒绝普通JS日志与陈旧报告，不替代设备执行
load-compiled-e2e-hook.js: 加载 compile-node-ts 产物供 Jest global hook 转发
local-e2e-server.ts: 提供本地版本、制品、forceBoot控制及只读/state请求时间线，供独立原生套件确认无JS点击的真实检查/下载
prepare-local-update-artifacts.ts: 以 v1 Hermes HBC 为 epoch 生成 full/diff/ppk/v2-track 本地更新制品；显式 RNU_E2E_BUNDLER=expo 复用 Expo export:embed，Harmony 保持独立路径
prepare-crash-rescue-artifacts.js: 显式宿主/CLI/平台编译独立 brick/fix Hermes full PPK，复用 RN/Expo 正常入口；保留入口与产物摘要、逐包构建日志，不重建 APK 或混用 HBC 版本
refresh-ios-app-bundle.sh: 复用缓存原生包并刷新当前 JS bundle/assets
run-prepare-local-update-artifacts.js: Node 转发入口，调用 TS 制品准备脚本
run-gradle.js: Windows 调用批处理、Unix 用 sh 读取 Android Gradle wrapper，保留参数/退出码并消除跨系统检出执行位对 npm/Detox 的影响
run-detox.js: 跨平台注入 E2E_PLATFORM 并调用 Detox CLI，消除 npm 脚本的 Unix 环境变量语法
start-rn.sh: 启动 Metro/RN 开发服务并在退出时回收进程
start-rn.js: 以 Node 托管 Metro 子进程并跨 Windows/Unix 转发终止信号

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
