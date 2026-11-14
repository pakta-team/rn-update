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

通过 CLI `--expo` 实际 export:embed 生成 HBC98 四 PPK；v2/v3/v4 的 v1 base-bytecode 编译验证等价，6145 functions。三个真实补丁经 WSL 当前 CLI 生成，manifest 禁 full 兜底。首次设备请求被 Android 明文网络策略拒绝，随后仅在测试宿主允许10.0.2.2/127.0.0.1并重建Release，保留SDK默认网络策略；当前实跑APK为`93272b4f6314b828f11a83304efb4aeabb6375525520ac1b7301cf9add416b14`，设备拉回摘要相同。

`expo-durable/expo-runtime-result.json` 为 passed，28个UI观察帧覆盖即时/延后两策略各full→diff→pdiff→v2-track，逐阶段markSuccess、进程重启保持及最终upToDate；延后下载先断言旧版本仍活动再重启激活。候选900文件守门、错摘要负控、HBC98基座bundle与x86_64库绑定见`expo-network-artifact-identity.json`及[Expo OTA地图](../scripts/expo-ota-map.md)。Expo57不支持旧架构；未执行真正坏JS救砖。

## 最终候选的平台消费输入等价

最终`TEMP/pakta-release-7uet8M/rn-update-1.1.0.tgz`的完整SHA-256仍为`b5ed311d93edb83564357369a10dab59608012351bade92f6125cc6ac55de237`，与先前83Z1Iy包完全相同。对历史989603包各900文件比对，891文件相同，9处差异仅7份Apple源码与2份Apple地图；scripts目录实际不发包，Python3.8 checker修复不改变此候选。

`android-matrix-final-candidate-equivalence.json`另对三个宿主实际消费树核对最终包的848份JS/Android/共享C++/Harmony文件及包入口配置，差异均为0；重新读取三个已从设备拉回的APK，核对原报告摘要、HBC96/98、基座bundle及全部SDK SO。RN085/RN077各4 ABI、Expo仅x86_64库均与最终包逐字节相同，probe.bundle均不存在；分宿主回执为`rn085-final-candidate-equivalence.json`、`rn077-final-candidate-equivalence.json`、`expo-network-final-candidate-equivalence.json`。

原设备报告中的989603候选与APK摘要保持不变。以上证明未变平台消费输入等价，不改写为以完整b5ed归档重建并重跑设备，也不证明Apple变更、其他ABI执行或全端发布准入。

## Harmony修复后的候选输入等价

新候选`TEMP/pakta-release-VDxQti/rn-update-1.1.0.tgz`，SHA-256`df181fb788169432a2d6f11f6718c429ca10f181921bc5941f9d467743303d9e`；与b5ed包各900文件对比，897文件相同，差异仅Harmony HAR、`install_napi.h`及其cpp地图。上段848项含Harmony，不能套用其零差异分母到本轮。

`post-harmony-candidate-equivalence.json`独立核对三宿主830份Android/JS/共享核及入口文件，零差异；重新读取三份设备拉回APK，原摘要、HBC96/98、基座bundle、全部入包SDK SO及无probe.bundle均保持，库与新候选一致。另核对包含Podspec、Apple源及HDiff/LZMA的796份保守Apple/JS/共享核输入，与b5ed零差异；它只延续未变输入关系，Apple实际构建和设备证据仍以对应原commit/candidate登记。

旧报告不修改，不把新df181写成已完整重建三宿主并重跑设备；Harmony原失败与重建HAR后的HAP/完整suite另由根平台回执记录。此处不扩展其他ABI执行、Apple设备或全平台发布准入。

最终GEB候选为`TEMP/pakta-release-G4U0R6/rn-update-1.1.0.tgz`，SHA-256`4818abacdfd97e308b80f8f8bbbb96ade221d58f1135e0a703d7b5069cc06cbf`。与df181各900文件对比，896文件逐字节相同；其余4份是`resume_plan.cpp`、`resume_plan.h`、`resume_plan_android.cpp`及Harmony的`resume_napi.h`，仅前置L3注释。`geb-native-l3-final/verification.json`保存9份原body并逐字节验证，`geb-final-candidate-equivalence.json`进一步证明4份发包文件去除精确注释前缀后与df181原文、已保存body及SHA-256一致，不能称原始C++整文件字节相同。

830项Android及796项Apple保守输入各有3份原始C++文件差异，验证仅上述注释前缀后主体差异为0；HAR92bb、JS/入口和四ABI Android SO均逐字节相同。三宿主消费树及三份历史设备APK/HBC/bundle/SO再次复核，旧运行身份保持；最终4818的完整Harmony构建和设备suite由根平台回执另记。

## 构建边界修复

主 Metro 观察 SDK 父根时只放行 src/package.json 和当前宿主，避免扫描其他 Example 与原生构建树；守门器同时验证放行/拒绝边界。RN077 生成器补复制 Node 编译配置并移除跨仓类型路径，3项持久回归通过，TEMP `compile-node-ts.js` 实际通过。

本轮不代称其他 ABI/物理机、API34、iOS/tvOS、完整坏 JS 救援、Actions 或生产准入。候选冻结与发布由根回执单独管理。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
