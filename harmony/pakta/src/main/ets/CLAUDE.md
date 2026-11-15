# ets/
> L2 | 父级: ../CLAUDE.md

ArkTS/ETS 更新运行时。UpdateContext 是状态聚合根，DownloadTask 承担断点下载与补丁落盘，NativeCheckOrchestrator 编排无 JS 检查，PaktaFileJSBundleProvider 兼任无桥宿主 configure/checkAndUpdate 门面，ErrorCodes/ArchiveLimits/InstallRecord 消费本地 contract 派生的常量，Package/TurboModule 文件只负责 RNOH 边界。

## 成员清单

ArchiveLimits.ts: contract.json 派生常量，平台保留磁盘空间探测；展开量和实际压缩长度驱动的异步解压目录审计委托共享核，拒绝符号链接和任意深度保留路径
ErrorCodes.ts: contract.json 派生稳定错误码，UpdateError（code 属性 + [CODE] 消息前缀）与转换逻辑仍由本文件实现
DownloadTask.ts: 执行 full/diff/pdiff/清理任务，Range 请求/响应及 sidecar 生成委托共享 resume_plan；保留流授权、空间守卫、进度与中断 partial，一次清零重试共享绝对预算，连接超时 15s
DownloadTaskParams.ts: 描述任务类型、制品身份、目录和冷启动截止时间
EventHub.ts: 单例事件总线，把下载进度投影到 RNOH RNInstance
InstallRecord.ts: .pakta-complete/schema1/staging 常量与兼容工具；记录构建/IO/完整性/保留路径/异步激活委托 NAPI，共享核只豁免真实零字节 marker；提供提交前同步快照复核，不持有平台状态
Logger.ts: 收敛 hilog debug/info/warn/error 输出格式
MonotonicClock.ts: 提供不受墙钟校准影响的 ACTIVE uptime 毫秒时钟
HarmonyRound.ts: 执行共享 StepRound 命令并回传事件，注入 IO/时钟端口，观察双代际、约束下载截止时间并 finally 清理 breadcrumb；不另写端点/下载策略
NativeCheckOrchestrator.ts: 冷启动/宿主共用单飞门，接共享配置门禁和 HostCancellation；宿主默认 30 分钟或自定等待期限，failed/timeout 仅结束本调用且清理计时器，底层轮次继续受双代际保护
NativePatchCore.ts: 声明 librnupdate.so 的状态机、补丁、摘要、配置/resume、轮次及十三安装/归档/manifest 类型边界；T27 删除四个旧flow声明，不改公共 TurboModule 契约
NativeUpdateConfig.ts: 无桥 configure 的类型/JSON 适配，先拒绝非对象/channel，再经 NativePatchCore/NAPI 委托共享 NormalizeConfiguration(..., true)，不触更新状态
NativeUpdateResult.ts: 无桥检查轮快照契约与 NativeUpdateRound 单飞原语（复用在途 promise、延迟调用含重入）
PathUtils.ts: 校验服务端控制的版本/文件名路径组件，阻止路径穿越
PaktaFileJSBundleProvider.ets: RNOH 文件 bundle provider，按 UpdateContext 选择热更或内置 bundle；兼无桥宿主 configure/checkAndUpdate(timeoutMs?)，期限透传且不重新解析 bundle 或重载实例
PaktaPackage.ets: 新 RNOH Package 注册器
PaktaPackageCompat.ts: 旧 RNOH TypeScript Package 注册器
PaktaPackageFactory.ts: 创建 Pakta TurboModule 工厂映射
PaktaTurboModule.ts: 暴露常量（含不可变 channel）、状态、下载、切包、重载、配置与缓存 API 给 JS
SaveFile.ts: 将 ResourceManager raw file descriptor 分块复制到沙箱
UpdateContext.ts: 单例更新上下文，读取 rawfile/meta.json channel，跨渠道安装时撤销旧热更；下载/清理/提交/切包共用 taskChain，摘要后复核双代际并同步复核快照紧邻状态写入；原旧布局与 buildTime 回退保留
CLAUDE.md: ArkTS/ETS 运行时的职责、依赖方向与成员地图

T08 还拥有 NativePatchCore 的状态/归档类型编号、DownloadTaskParams 的任务编号及 NativeCheckOrchestrator 的 HTTP 尝试上限声明，不生成 ArkTS 执行路径或 NAPI。T09 以本地 NativePakta.ts 校验 PaktaTurboModule.ts 的参数、返回和 async 形状，C++ 注册表由同一 Spec 派生，业务委托仍在 ArkTS。

T12 的 clearVersionScopedState 统一 reset/二进制/渠道清理，先删 firstLoadMarked 与 nativeCheckResp，再枚举删除 hash_*；保留 uuid/nativeConfig/bundleHashCache、breadcrumb 和未知安装 KV，不 clear、不换库。getAllSync 缺失或抛错仅遗留 hash 孤儿，状态与响应缓存仍失效；reset 单批落盘后沿原串行任务保护 launchVersion，二进制/渠道保留既有三天回收策略。VM 回归不是 Harmony SDK/设备或落盘耐久性证据。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

T11 Harmony：DownloadTask 原始 manifest 文本直接交共享 parser（CRC/HBC/保留路径），解压审计异步委托共享累计器，既有 Seal 后代际门和同步 Promote 保留。UpdateContext/轮次不在本轮所有权内，提交方必须消费不透明激活快照并在状态锁内紧邻提交复核；NAPI/CMake 集成缺口与实跑边界见 scripts/install-map.md。新增依赖/接口以本地图为准，既有 L3 未追加注释。

T15 后续已完成上述 NAPI/CMake 与提交快照集成缺口：见 ../../../../../scripts/harmony-round-map.md。该节 T11 所有权及“既有 L3 未追加”仅表示历史阶段；本次补 HarmonyRound 的 L3 并修正 NativeUpdateConfig 共享委托契约，不迁移 KV/schema、不改宿主 API，也不重跑历史验证。
