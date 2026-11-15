# main/
> L2 | 父级: ../CLAUDE.md

Harmony 主进程实现。ArkTS `Index` 选择 Metro、Pakta 文件和 rawfile provider；C++ `PackageProvider` 将 PaktaPackage 注册到 RNOH。

## 成员清单

cpp/: RNOH app 动态库的 CMake 与 Pakta PackageProvider
module.json5: HAP 能力、Ability 与设备安装策略清单；EntryAbility 同时接收桌面启动和 testhotupdate scheme 的 viewData 深链，保留本地应用身份
ets/: ArkTS Ability、页面与 RNPackagesFactory 实现
ets/RNPackagesFactory.ets: 创建 Pakta RNPackage
ets/pages/Index.ets: RNApp、bundle provider 与 back press 容器
ets/entryability/EntryAbility.ets: RNOH Ability 页面路径
ets/entrybackupability/EntryBackupAbility.ets: 备份/恢复回调

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

SDK-57（2026-11-14）：按上游 b808858 补齐 viewData/testhotupdate skill，桌面 home skill、Ability 与 Pakta bundle 身份保留。JSON5 解析及两类 skill/本地身份断言通过；现有 HarmonyDriver 仍以 bundleName+abilityName 启动，不据此声明 URI 参数传递、forceBoot 或新签名 HAP/设备唤起已验证。
