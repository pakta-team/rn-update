# e2e/
> L2 | 父级: ../CLAUDE.md

端到端验证层。主 runner 覆盖本地 full/ppk/package/v2-track 更新链，分 runner 的 smoke、native 与 Harmony 套件隔离设备预算；global hook 只准备和清理本地服务，不定义 SDK 业务规则。

## 成员清单

CLAUDE.md: e2e 套件拓扑、runner 边界与成员地图
android-boundaries.test.ts: Android Release 真实损坏/缺失 diff 拒绝、已确认版本保持与进程重启回归；临时制品写入始终恢复，manifest 禁全量兜底
bundle-hash.test.ts: 读取 iOS 缓存或 Android 原生桥诊断，以跨平台 ZIP 解析核对 bundleHash 与字节摘要
detox-hooks.d.ts: Detox globalSetup/globalTeardown 的环境声明
entry.brick.ts: §11 救砖实验的故障 bundle 入口，故意在启动后触发崩溃
entry.fix.ts: §11 救砖实验的修复 bundle 入口，解除故障标记后加载应用
entry.v1.ts: 本地 full 更新基线 bundle 入口
entry.v2.ts: 本地 ppk diff 更新 bundle 入口
entry.v3.ts: 本地 package diff 更新 bundle 入口
entry.v4.ts: v2-track 更新 bundle 入口
globalSetup.js: 编译并转发 globalSetup.ts，供 Detox runner 调用
globalSetup.ts: 生成本地制品、启动更新服务并委托 Detox 全局准备
globalTeardown.js: 编译并转发 globalTeardown.ts，供 Detox runner 调用
globalTeardown.ts: 停止本地更新服务并委托 Detox 全局清理
harmony.jest.config.js: HarmonyOS hdc/uitest 套件的独立 Jest runner
harmony/: HarmonyOS 更新流与 smoke 测试
harness/: HarmonyOS 设备 UI 驱动和布局解析适配
jest.config.js: 常规 Detox 本地更新 runner，排除独立平台套件
local-merge.test.ts: Android/iOS full、ppk、package 与以 Hermes v1 为基线的 v2-track 串行更新验收
localUpdateConfig.ts: 各平台本地端点、制品、hash、label 与最终状态常量
LOCAL_WINDOWS_ANDROID_TEST.md: 当前 Windows Android SDK/AVD 的 Release APK、制品、Detox 套件、局域网真机真服务与故障排查手册
native/: 原生冷启动检查 runner 与 forceBoot 验证
smoke/: Debug 首屏启动 smoke runner 与测试

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
