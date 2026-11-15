# 1.2.0 独立仓库同步回执

同步日期：2026-11-15。SDK 来源为整合仓库提交 `69aac6a8f4f1c7a4b5b910b49940f0203f29699d` 的 `rn-update/` 子树；公开仓库同步前为 `b2eba4c`。用户已指定 SDK 与独立 CLI 统一采用 `1.2.0`。

## 同步与边界

- 同步 SDK 功能、优化、修复、共享 C++ 内核、Android 四 ABI 库、Apple/Expo/Harmony 适配、测试、示例和架构地图；删除源端已退休的 `cpp/update_flow_core/update_flow_jni.cpp`。
- 保留公开仓库的 `.gitmodules` 和原生子模块提交：HDiffPatch `eb959d671cd94281ca763d609f638b5d248df3a3`、lzma `c80bb80bbbac61da7ec02d12fb497851b1f59635`。
- 版本同步仅拥有本仓库 `package.json`、Harmony `oh-package.json5` 与 `BuildProfile.ets`；不会访问或改写父目录、兄弟 CLI。npm 仓库链接指向公开仓库根，Podspec 源码标签与 `v*` 发布入口一致。
- 独立 CI 直接消费根 SDK；需要 CLI 的设备测试通过独立 checkout 和显式 `RNU_CLI_ROOT` 消费公开 CLI。应先将配套 CLI `1.2.0` 源码同步至其远端，再运行设备矩阵，详见 `.github/actions/setup-cli/` 与工作流地图。
- 共享 `CLAUDE.md` 地图保留。源子树中的两份 Sentry 本地凭据配置和一份 MCP 配置已排除公开 Git 清单，样例 debug keystore 保留；本轮没有改动整合仓库或发布凭据。

## 本地验证

- 冻结锁安装成功；版本调整前的同步源码通过 SDK 460 项、跨语言 contract 10 项、RN077 生成器 3 项测试。随后 SDK 运行源码未变，1.2.0 元数据通过下述版本、强制类型与实际包检查；不称全套测试在最终 tgz 上重新执行。
- lint、TypeScript、显式 DevEco SDK 的 Harmony 类型检查和四端 19 方法桥契约通过；首次未提供 SDK 环境时的跳过结果不计为类型验收。
- 四 ABI `.so` 的架构、16 KiB 对齐、20 个必需 JNI 符号与禁串门卫通过；独立版本隔离及候选/源码闭包/原生门卫 48 项 Node 回归通过，真实 HAR 5 项和禁串 4 项回归通过，均无跳过。
- CocoaPods 28 种平台/架构组合与三个突变门卫通过；Apple 提取源码回归 20 项通过，含 34 条轮次轨迹。这是源码/宿主检查，不是本次 Xcode 原生构建。
- 版本更新后在本目录真实构建 Harmony Release HAR，30 个任务全部执行；`release:prepare` 真实运行 prepack、强制 Harmony 类型检查、声明构建，仅打包一次，同一 tgz 通过 900 文件源码/原生产物门卫及独立宿主 15 项公开 API 声明消费检查。
- 独立 CI 的 8 个工作流通过 actionlint，127 段 Bash、4 段内嵌 Node、3 段 PowerShell 语法及 15 类脚本路径闭包通过；发布候选 6 项、WSL tvOS 9 项、Harmony PlanOnly 正控与 6 项拒绝边界通过。原生 Windows tvOS 首轮为 8 项成功、1 项符号链接权限错误，保留原记录；WSL 通过不追认 Windows 成功。这些检查没有运行 Actions 或操作设备。

## 1.2.0 候选身份

| 制品 | SHA-256 |
| --- | --- |
| `rn-update-1.2.0.tgz` | `1d7a9fad51a1895af7769f93acccf0e48948fe181951bec535e8725375f6b782` |
| `harmony/pakta.har` | `cce708b09d6aa3a5a19c34e65d1494905d68ce3840782c24b5556e5edb1b4498` |

候选位于本机 `TEMP/pakta-release-fGUQ8p/rn-update-1.2.0.tgz`。HAR 为 1.2.0/release/DEBUG=false、21 份 ETS、双 ABI 各 21 个注册；四个内含共享库逐字节保持源端已验收的生产库，版本元数据通过本次真实构建更新。HAR 在 Git 中保持 ignored，CI 会从源码重建；本地发布准备使用上表候选中的 HAR。

## 证据范围与下一步

最终独立审阅 26 项检查通过：源文件无遗漏、296 项业务/原生输入与源逐字节一致；900 个包文件与当前 checkout 逐字节一致。独立仓库版本/脚本/Podspec/地图取舍单列，不将它们称为源字节一致。全部候选 Git 文档的相对链接与 L2 父图断链为零。

本轮日志、同步清单、目标原受控快照和独立安全审阅在本机 `TEMP/pakta-public-sdk-sync-98jklsjr`；原 `.github` 另有独立备份。快照不包括用户所有 ignored 文件或系统数据。

独立 CI 最终回执在 `TEMP/pakta-public-sdk-ci-verification-f7hafc60/verification.json`，40 文件清单 SHA-256 为 `c94c879c97e1a5274abeaf7e6b12af7fed05d8563a827e17fcf33f4c844c22b4`。

本次工作完成本地同步、版本更新和发布包验证；尚未提交、推送、创建 tag、上传 npm 或创建 GitHub Release，也未重新运行公开仓库 Actions/完整设备矩阵。源仓库既有 Mac、Expo、Android、tvOS 和 Harmony 验收分别绑定原候选，不追认为这个 1.2.0 包的设备验收。地图内历史 T 系列记录仍描述其原输入；本文件仅说明本轮独立仓库结果，不重新解释历史失败或跳过。

源仓库中已受控的 Sentry 令牌建议独立轮换；公开 Git 清单和本次 npm 候选均不包含这些配置。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
