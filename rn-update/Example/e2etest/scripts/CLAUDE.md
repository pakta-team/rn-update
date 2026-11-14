# scripts/
> L2 | 父级: ../CLAUDE.md

e2etest 构建与编排脚本层。脚本只组合已有 SDK、平台工具和本地服务协议；制品准备、Node/TS hook 编译与 iOS/Harmony 构建的副作用均从测试入口显式触发。

## 成员清单

CLAUDE.md: e2etest 脚本职责、入口与成员地图
assert-local-sdk.js: 在构建/测试前断言 Metro 与 RN CLI 均指向当前工作树 SDK，且扫描只放行运行输入、不遍历其它样例与原生构建树
build-real-service-android.js: 从环境变量生成忽略提交的基线/更新入口，并按 apk/ppk 模式构建网络配置一致、可参数化 channel/packageVersion 且不污染默认 Detox 配置的真服务 Android 制品
build-local-device-android.js: 从局域网 endpoint 生成忽略提交的入口并构建连接本地 E2E server 的 Android Release APK，隔离模拟器的 10.0.2.2 默认值
build-harmony-e2e.sh: 构建并安装 HarmonyOS e2e 基础应用；默认 release buildMode（debug hap 会跳过 markSuccess 导致重启回滚），hvigor 优先使用 DevEco 自带 Node 规避新版 Node 的 fs.rmdirSync 拒绝
compile-node-ts.js: 将 TS hook 编译到临时目录并解析 Node 可执行入口
create-rn077-oldarch-project.js: 校验显式本地 tgz 后生成 RN 0.77.3/CLI 15.0.1 宿主；复制候选至工程内，重定位 Metro/CLI 到安装树，拒绝覆盖既有工程
assert-rn077-oldarch.js: 校验候选摘要、关键安装字节和 JS/native 同根；--release 强制宿主与 SDK BuildConfig 均为旧架构且 APK 存在
rn077-runtime-proof.js: 生成宿主启动前验证 RN077、legacyBridge 与 NativeModules.Pakta 同一对象，拒绝 bridgeless/Turbo/Fabric
rn077-oldarch.test.js: Node 持久正负控，覆盖仓库外含空格 TEMP、候选篡改、双 BuildConfig 与运行时架构；SDK test:rn077-generator 及常规 test 接入
rn077-oldarch-map.md: RN077 生成/候选/Release/设备分层证据与未验边界，明确旧 TEMP smoke 不等于生成器全链通过
detect-ios-simulator-type.js: 选择与 Detox 一致的 iOS 模拟器 runtime
generate-platform-diffs-wsl.cjs: 在 Windows 无 hdiff 原生绑定时，通过显式 Android/Harmony 平台拓扑选择正确基线并生成真实差分
ios-rescue-server.ts: §11 iOS 救砖实验的状态化本地 HTTP 服务
load-compiled-e2e-hook.js: 加载 compile-node-ts 产物供 Jest global hook 转发
local-e2e-server.ts: 提供本地版本、制品、控制与状态接口
prepare-local-update-artifacts.ts: 以 v1 Hermes HBC 为 epoch 生成 full/diff/ppk/v2-track 本地更新制品
refresh-ios-app-bundle.sh: 复用缓存原生包并刷新当前 JS bundle/assets
run-prepare-local-update-artifacts.js: Node 转发入口，调用 TS 制品准备脚本
run-gradle.js: 跨平台调用 Android Gradle wrapper，统一 npm 与 Detox 的 Windows/Unix 行为
run-detox.js: 跨平台注入 E2E_PLATFORM 并调用 Detox CLI，消除 npm 脚本的 Unix 环境变量语法
start-rn.sh: 启动 Metro/RN 开发服务并在退出时回收进程
start-rn.js: 以 Node 托管 Metro 子进程并跨 Windows/Unix 转发终止信号

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
