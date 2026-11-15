# harmony/
> L2 | 父级: ../CLAUDE.md

HarmonyOS/RNOH 集成。`pakta` 是真实 HAR 原生模块，`har-wrapper` 提供可发布包装，`types` 补足宿主与原生库声明，根 Hvigor 插件把共享 C++ 产物接入构建。

## 成员清单

har-wrapper/: HAR 发布包装工程、应用级元数据与 Hvigor 配置，不承载更新业务规则
pakta/: ArkTS/ETS 更新模块、RNOH TurboModule C++ 桥、模块清单及单元测试
types/: ArkTS 全局、RNOH 与 `librnupdate.so` 的编译期声明
CLAUDE.md: HarmonyOS 集成的模块边界、成员与数据流地图
hvigor-plugin.ts: Harmony 构建扩展，刷新 rawfile 构建 UUID/版本名并保留宿主中性 channel（缺省 default）
pakta.har: 当前1.1.0默认Release制品，包含SDK-26宿主等待、SDK-08路径裁剪及激活快照NAPI重入修复；21份ETS、双ABI各21注册及四库禁串通过，最新摘要92bb0c…及设备失败/修复边界见../scripts/harmony-round-map.md；本地文件沿用忽略规则

`pakta/src/main/ets/NativeCheckOrchestrator.ts` 编排冷启动检查，下载/保存/上下文类提供 IO，`NativePatchCore.ts` 连接共享内核，Package 与 TurboModule 文件只负责 RNOH 注册和 JS 边界。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
