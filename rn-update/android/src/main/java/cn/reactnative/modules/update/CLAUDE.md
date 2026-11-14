# cn.reactnative.modules.update/
> L2 | 父级: ../../../../CLAUDE.md

Android 更新业务核心。UpdateContext 持有持久状态和文件事务，DownloadTask 执行网络/归档工作，NativeCheckOrchestrator 负责无 JS 冷启动自救，UpdateModuleImpl 是新旧桥共享的命令门面，PaktaNativeUpdate 提供不经过 React Native 桥的宿主直连 API。

## 成员清单

ApkInstaller.java: APK 会话式安装执行器，权限确认到 PendingIntent 回执全链路 reject 而不崩溃；写入流先关闭再 commit 会话，避免系统拒绝 seal
ArchiveLimits.java: contract.json 派生解压伤害上限常量，磁盘余量守卫仍由本文件实现
ArchivePatchPlanResult.java: JNI 归档补丁规划 DTO，返回合并源子目录与是否启用目录合并
AndroidRound.java: StepRound 命令执行器，启动只消费配置/reset/config 原子快照，HTTP 与下载期间观察实时双代际并取消任务，提交回执交回共享核，finally 回收 breadcrumb；不决定端点或策略
BundledResourceCopier.java: 只读消费 DownloadTask 校验后的目标 File map 与来源 CRC map，从 base/split APK 或 Resources 复制未变资源；用目标父目录恢复密度限定符，拒绝内容漂移，日志复用 UpdateContext.TAG，不扩展 JNI DTO
CleanupKeepNames.java: 清理 JNI keepnames 版本名选择纯函数（最多两个互异版本）
CopyGroupResult.java: JNI 复制分组 DTO，把单一来源路径映射到多个目标文件
CrashRescue.java: 在启动早期未捕获异常窗口内限时完成原生检查，并始终交还既有崩溃处理器
DownloadTask.java: 单线程下载执行器，经 ResumePlan 委托续传决策，保留 OkHttp/空间守卫/HTTPS 降级拒绝/取消及完整性检查；失效范围只清零一次，重试共用绝对截止时间
DeviceRound.java: AndroidRound 的设备端口，从 UpdateContext 获取锁内启动快照并采集 Manifest channel/opaque buildTime/启动回滚身份，委托既有下载入口与双代际原子提交，跟踪并取消真实 OkHttp Call
ResumePlan.java: 内部静态 JNI 门面，JSON 字符串连接共享 resume_plan，非 React Native 公共桥，不改变 NativePakta/contract
DownloadTaskParams.java: 下载任务命令对象，封装任务种类、身份、目录、截止时间与完成监听器
ErrorCodes.java: contract.json 派生稳定错误码，统一归类下载异常供命令执行器与 JS 门面复用；派生器只拥有常量声明
FileOperationException.java: 标记本地文件规则拒绝的下载失败（如原地重装运行中版本），按 FILE_OPERATION_FAILED 归类
HttpUtils.java: 无 Android/OkHttp 依赖的 URL/Content-Range 纯字符串工具，JVM 可测
InstallRecord.java: .pakta-complete 完成记录与 staging 工具（fsync + 目录 sync），仅零字节文件兼容旧 marker，非空文件解析为空对象时拒绝，防止绕过完成判定与激活校验；schema 1 强制 bundleSha256，schema/记录名/后缀由 contract.json 派生
NativeInstall.java: 内部安装 JNI 门面，execute 分派共享记录/Seal/Promote/manifest/目录审计，inspect 使用有界条目数组，激活快照以不透明句柄管理；不扩展 RN Spec
NativeCheckOrchestrator.java: 冷启动/宿主/救援单飞门；宿主 claim 后独立守护线程运行 AndroidRound，各调用等待至自身期限，failed/timeout 不取消轮次；保留 HTTPS、响应限额与配置/reset 双代际
NativeUpdateCore.java: librnupdate 单次加载门与原生 diffVersion 能力查询
NativeUpdateConfig.java: configure 的 JSON 适配器，经 NativeUpdateFlow/JNI 委托共享 NormalizeConfiguration(..., true)；白名单/URL/默认服务与去重不在 Java 重写，拒绝 channel，不触更新状态
NativeUpdateFlow.java: 共享配置归一化/门禁/等价、StepRound 和 HostCancellation 的五入口 JNI 门面；T27 移除无生产消费者的四个旧请求/排序/响应声明，不改变公共桥
NativeUpdateResult.java: 无桥检查轮不可变快照（五个状态常量 + of/downloaded 工厂），downloaded 不代表运行实例已重载
PackageInstallerStatusReceiver.java: PackageInstaller 会话状态回执 Receiver，转交 ApkInstaller.handleStatus
PatchFailedException.java: 标记制品已下载后的解包/补丁/资源复制失败，使遥测区别补丁质量与网络失败
PaktaFileProvider.java: AndroidX FileProvider 专用子类，避免宿主 Manifest provider 名称冲突
PaktaNativeUpdate.java: 无桥宿主 API 门面，configure 单线程与 checkAndUpdate 并发等待池隔离；旧检查签名默认 30 分钟，可用 timeoutMillis 重载缩短等待，回调主线程，超时不重载或取消共享轮次
ReactNativeHostHandler.java: 旧式宿主生命周期兼容接口，描述 bundle 选择与 React 实例创建钩子
ReactReloadManager.java: 跨 React Native 新旧架构重载器，按 ReactHost/InstanceManager/Activity 依次降级
SafeZipFile.java: 带 Zip Slip 防护的 ZipFile，校验条目名和规范化目标路径后解压
StateCoreResult.java: Java/C++ 状态机 DTO，承载切包、首启、回滚和清理决策结果
StateSerialRunner.java: 专用单线程状态执行器，在后台串行提交 SharedPreferences 写入并统一 Promise 错误
UiThreadRunner.java: React 重载等 UI 副作用的主线程执行器与 Promise 错误适配
UpdateContext.java: Android 更新聚合上下文，读取 Manifest 固定 channel，跨渠道覆盖安装时撤销旧热更，管理持久状态、下载队列、bundle 选择、回滚、重置与原生检查提交锁；snapshotNativeRound 与配置写入共用 commitLock，禁止新代际配旧配置；无 UI 启动保留 firstTime，首次 Activity started 在既有锁内复核实际加载版本后补记，切包对带记录目录一律复核摘要
UpdateEventEmitter.java: 弱引用 ReactApplicationContext 的下载进度事件桥，在实例销毁竞态下安全降级
UpdateFileUtils.java: 更新目录创建、递归删除、文件/流复制的集中 IO 原语
UpdateModuleImpl.java: 新旧架构共享命令门面，将 JS 调用映射到下载、channel/版本常量、状态串行器、重载器与稳定错误码
UpdateModuleSupport.java: 新旧桥共享常量投影与 Android APK 安装 Intent 适配
UpdatePackage.java: TurboReactPackage 注册器，按构建常量声明 Pakta 模块的架构元数据
CLAUDE.md: Android 更新核心的职责边界、协作关系与成员地图

T08 还拥有 DownloadTaskParams 的任务编号、UpdateContext 的状态操作码与 NativeCheckOrchestrator 的 HTTP 尝试上限声明；生成器不拥有文件 IO、JNI、清理或状态转换。T12 的 clearVersionScopedState 被 reset 与二进制/渠道同步共用，只删 firstLoadMarked、nativeCheckResp 和 hash_*，状态字段由 applyState 重写；保留 uuid/nativeConfig/bundleHashCache、中断 breadcrumb 与未知安装级 KV，reset 写回 binaryChannel。旧 update SharedPreferences 与 _update 目录不变；文件删除仍交给既有串行队列和执行时 keepnames，不授权整库 clear。验证与降级边界见 scripts/contract-map.md。

T15 Android 已用共享 StepRound 替换手写轮次，NativeUpdateConfig 仅委托共享宿主归一化，白名单由 native_config 拥有；不开放 config.channel 覆盖。T11 后续在既有 versionFilesLock → commitLock 顺序下补全两条提交入口的 Unchanged 和祖父身份复核，Seal 后晋升复核下载双代际/取消及 staging 快照，保护 running/current/last；不改轮次、KV/schema 或 RN/Expo API。

T11 Android：InstallRecord 不再自行实现摘要/记录 IO；AutoCloseable Activation 保证成功/拒绝均 release。DownloadTask 原始 manifest 先过共享 parser，再投影 copies/CRC/deletes/HBC；SafeZipFile 中央目录累计和任意祖先保留路径委托共享核，平台仍拥有 Zip Slip/流式字节/空间/网络守卫，full/diff 解压后审计再执行既有 patch。旧 _update/update/schema1/zero marker 保留。详细契约见 scripts/install-map.md；本次仅补 AndroidRound/DeviceRound/NativeInstall 的 L3 与 NativeUpdateConfig 委托事实，不重跑历史验证。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
