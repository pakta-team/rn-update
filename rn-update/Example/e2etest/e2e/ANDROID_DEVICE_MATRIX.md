# Android 当前候选设备矩阵
> L2 补充 | 父级: ./CLAUDE.md

## 输入身份

本轮证据目录 `%TEMP%/pakta-device-matrix-20261114`。起始候选为 `%TEMP%/pakta-release-HbWYTs/rn-update-1.1.0.tgz`，SHA-256 `989603f4562957146935a50724a3beb010ac864c0feede42c0a4cbdc1c855cd1`；SDK 工作树、RN077 安装树与 Expo 安装树各对候选 900 文件逐字节核对，差异均为 0。后续候选若变化，必须另记差异和目标平台输入关联，不能沿用该摘要。

设备 `emulator-5554` 是 API36/x86_64 AVD `Medium_Phone_API_36.0`；`abilist` 包含 arm64 不等于执行过 arm64。四 ABI 入包可由字节核对证明，运行覆盖只计 x86_64。未 wipe AVD，不清理其他应用数据。

## RN0.85.2 新架构

主宿主强制消费当前工作树 SDK，强制重跑 `createBundleReleaseJsAndAssets` 后构建 Release 与 instrumentation APK。Release SHA-256 `b6cb1cc94f27f30b45dc8183b328707882cd83930535077611b71d1fdd73a813`；从设备拉回 APK 摘要相同，四 ABI `librnupdate.so` 与候选字节一致。此次未重编生产 C++。

四个 PPK 全新生成；HBC98，v2/v3/v4 相对 v1 的 base-bytecode 编译均验证与普通编译等价。WSL 当前 CLI 生成真实 diff/pdiff/v2-track，ZIP CRC、HDIFF 头与 `fullFallback=false` 均核验。未使用历史 PPK。

| 层次 | 结果 | 证据 |
| --- | --- | --- |
| 原生冷启动 | 1套/1项通过，无 JS 手动 check 时仅 forceBoot 激活 | `rn085-native.log` |
| 完整 core | 3套/5项通过：即时/延后 full→diff→pdiff→v2-track、bundleHash、损坏/缺失补丁安全 | `rn085-merge-final.log`，`C:/Temp/m36merge` |
| 真实坏 JS 救援 | 未执行；forceBoot 套件不能替代该证明 | 保留待验 |

故障套件逐例使用干净测试应用，再下载并确认 v1。损坏或移除真实 v1→v2 补丁时，现有契约报告 `errorUpdate`；确认 hash 保持 v1，进程重启后仍为 v1，finally 恢复补丁。补丁损坏由原生 `PATCH_FAILED` 拒绝，服务器不提供 full 兜底。

首次故障测试的普通 `expect` 被 Detox 全局替换，后改用 Node assert；下一轮错误地等待 `errorDownload`，已按现有客户端契约改为 `errorUpdate`。中间 adb daemon/offline 与 Windows 长路径拉日志失败均保留，不能计为整轮通过。最终短路径一轮 3套/5项完成且五份 device.log 拉取成功。

## RN0.77.3 旧架构

隔离宿主 `%TEMP%/pakta-rn077-generator-20261114/AwesomeProject`。候选为普通独立安装目录；双 BuildConfig 为 `newArchEnabled=false`，入口运行旧桥身份断言。Release SHA-256 `837eb3e44cc3e99f2ced6834b961dbf42be8c27dd61749111b29103cedfea5f6`，四 ABI SDK SO 与候选一致；HBC96 四 PPK 和三个真实补丁独立生成，不能复用 RN085 制品。

Release 构建通过；instrumentation 依赖因 Google Maven 超时，最后通过 TEMP init script 使用 Google 公开镜像完成，不修改仓库仓储或依赖版本。其间一次 JVM 页面文件不足和一次 PowerShell 参数分词失败均保留。

完整 core 3套/5项通过：两策略 full→diff→pdiff→v2-track、bundleHash、损坏与缺失补丁后保持 v1 并重启；`rn077-core.log` 与 `C:/Temp/m77core` 五份 device.log 为本轮证据。原生冷启动另 1套/1项通过，见 `rn077-native.log` 和 `C:/Temp/m77native`；仍不能替代真实坏 JS 救砖。从设备拉回 APK 与构建摘要相同。

## Expo57/RN0.86.3 新架构

隔离宿主 `%TEMP%/pakta-expo-host-20261114/host` 保留正常 ExpoReactHostFactory。已去除历史 `probe.bundle` 与直接写 SharedPreferences 的选包注入，使用 Expo registerRootComponent 和真实 OTA UI。

原 TEMP node_modules 缺运行文件，按相同 name/version 从完整 Expo 示例补齐缺失文件，不覆盖候选 SDK；版本冲突为 0。Metro 限单 worker 后 Release 构建通过：APK SHA-256 `f379a02e859a0acdb3a3c1b9641cbf5d8471984ada9f7448e4782ad5261deb77`，仅 x86_64 SDK SO 入包并与候选一致，无 probe bundle。

通过 CLI `--expo` 实际 export:embed 生成 HBC98 四 PPK；v2/v3/v4 的 v1 base-bytecode 编译验证等价，6145 functions。三个真实补丁经 WSL 当前 CLI 生成，manifest 禁 full 兜底。设备更新链完成后补入本节；Expo57 不支持旧架构，不能计为 Expo 旧桥验证。

## 构建边界修复

主 Metro 观察 SDK 父根时只放行 src/package.json 和当前宿主，避免扫描其他 Example 与原生构建树；守门器同时验证放行/拒绝边界。RN077 生成器补复制 Node 编译配置并移除跨仓类型路径，3项持久回归通过，TEMP `compile-node-ts.js` 实际通过。

本轮不代称其他 ABI/物理机、API34、iOS/tvOS、完整坏 JS 救援、Actions 或生产准入。候选冻结与发布由根回执单独管理。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
