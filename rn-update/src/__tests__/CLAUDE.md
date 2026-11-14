# __tests__/
> L2 | 父级: ../CLAUDE.md

Bun 回归层。纯函数套件验证无 IO 决策与协议映射，客户端和 Provider 套件用受控 React Native/网络替身验证副作用边界；`setup.ts` 统一恢复全局 mock，防止测试顺序泄漏或真实网络访问。

## 成员清单

CLAUDE.md: 本测试模块的成员、隔离策略与验证边界地图
app.plugin.test.ts: Expo Config Plugin 契约回归；验证 channel 双端写入、无 channel 不动、非法值抛错与幂等重写
androidHostWait.test.ts: JDK 17+ 编译完整真实 Android 宿主门面/编排器/结果类，替换 Android API/轮次 IO/配置核，验证独立短长等待、30 分钟默认、超时后结果复用、双代际拒绝与中断；不代表 JNI/ART 或系统主线程
appleInstallRecord.test.ts: T11 Apple生产commit提取harness，断言共享摘要预检锁外、Unchanged锁内与零写/代际/tvOS窗口；公共switch及归档holder接共享累计器的连线静态检查，真实语法/安装核另由Python验证，不冒充Foundation
client.test.ts: Pakta 应用服务主回归；覆盖配置、错误管线、下载链、单例、原生配置同步和检查缓存
clientActivation.test.ts: M1/T07 激活合约；受控原生回执验证 expectedHash、并发与同步重入单飞、拒绝/异常重试、reset 成败边界及旧结果不得置位、上报或清除新任务
clientBoundaries.test.ts: M1 拆分前建立的特征测试；覆盖三端 channel/body、可写缓存字段与根响应、旧失败 slot ownership、公开网络/报告/激活方法替换、loggerPromise 替换、expectedHash 与查询参数模块状态隔离
clientTelemetry.test.ts: 客户端遥测最小集成回归；验证下载降级从本地事件到服务端请求体的单次归类及激活前 download_success 回执等待
context.test.ts: React Context 守卫与默认值回归；验证 Provider 外消费和开发态错误边界
core.test.ts: 原生桥常量解析回归；验证版本信息、bundle hash 与原生能力兼容读取
endpoint.test.ts: 多端点执行回归；验证 hedge、超时、去重、胜者选择与失败聚合
error.test.ts: 错误码契约回归；验证稳定码收窄与跨平台 [CODE] 消息前缀解析
errorReporting.test.ts: 错误上报回归；验证异常限长序列化与全局 ErrorUtils 处理器链式安装/卸载
flowVectors.test.ts: JS/C++ 更新流黄金向量一致性检查；阻止跨语言决策语义漂移
harmonyInstallRecord.test.ts: T11 真实 Node NAPI addon + 共享安装核/文件 IO/SHA-256 驱动真实 ArkTS InstallRecord/ArchiveLimits/DownloadTask VM；覆盖 Seal/Promote/激活快照/归档/manifest，Windows 需 Ubuntu WSL 与 C++17/Node headers，不冒充 OpenHarmony 设备
harmonyRound.test.ts: T15 真实命令执行器回放26条适用共享向量及覆盖门禁；比较事件、IO命令、双预算与回执，核心由轨迹替身提供
harmonyCommit.test.ts: T15 真实UpdateContext VM延迟摘要验证串行队列、快照变化零业务写入、配置代际门禁和公共切包队列恢复；存储/快照替身不冒充设备
i18n.test.ts: 语言选择、回退与插值回归；保证无外部运行时的文案解析稳定
isInRollout.test.ts: 灰度哈希与桶命中回归；锁定跨端 rollout 的确定性
metadata.test.ts: 崩溃元数据回归；验证 getUpdateMetadata 聚合、rescueSource 归类与 tag 投影
nativeBindings.test.ts: T09 真实生成器/parity 回归，临时副本验证 19 方法/16 Promise、幂等与只读检查、签名/委托/方法表漂移及不支持 AST 拒绝，不装载原生运行时
nativeConfiguration.test.ts: 无桥配置回归；30秒准备钩子预编译真实共享核后按默认预算断言，Harmony适配器VM验证fixed-host白名单、默认/错误、等价/取消及UpdateContext落库幂等；不冒充三端原生运行
nativeConfigHost.ts: 配置专项C++子进程适配器，套件准备阶段触发每进程首次编译生产共享核及config_host，Windows经Ubuntu WSL执行；仅传输JSON和编译失败，不实现配置规则
nativeHostApi.test.ts: VM 隔离运行真实 Harmony 编排器/执行器，验证状态映射、并发单飞、独立等待/默认期限、计时器释放与超时后双代际零提交；配置核/网络 IO 为替身
nativeUpdateRound.test.ts: 单飞门回归；验证并发共享、重入前发布、失败轮复用、意外拒绝不重启与下载/激活分离
packageTypes.test.ts: T10 发包契约回归；验证声明/运行入口分离、Codegen 仍用 src、旧声明清理与两次编译确定性；tarball 消费另见 scripts/check-package-types.js
provider.contract.test.tsx: Provider 与真实 Pakta 客户端的契约回归；守护渲染套件 fake 客户端与真实行为一致，验证无参立即/延后切换优先已下载 hash
provider.render.test.tsx: UpdateProvider 渲染与交互回归；验证状态投影、提示、AppState 和动作编排
resolveCheckResult.test.ts: 检查结果归一化回归；验证当前身份、目标版本与异常响应的纯决策
resumeDownload.test.ts: T13 执行真实 Harmony DownloadTask 控制流，经宿主子进程调用真实 C++ resume_plan；模拟网络/文件 IO，覆盖 206/416/非法与编码范围、重试上限、中断后再续、完整文件免请求和 HTTP 错误体隔离；自动编译，Windows 需 Ubuntu WSL，Unix 需 C++17，不代表设备或 NAPI 运行
setup.ts: Bun 全局测试隔离器；预装 React Native 替身并在每例后恢复模块和 fetch
telemetry.test.ts: 遥测纯函数契约；验证事件类型、目标 hash 与详情截断映射
updateFlowCore.test.ts: 无 IO 更新流单测；覆盖请求体、端点排序和下载策略选择
utils.test.ts: 横切工具回归；验证 URL、进度、超时 fetch、HTTP 降级与 Promise 聚合
versionScopedCleanup.test.ts: T12 旧布局清理回归；Android/Apple 真实 helper 受限转换执行，Harmony 真实 helper 与完整 UpdateContext VM 验证三入口单次 flush、安装级保护及枚举缺失/异常；入口连接与目录保护仅静态检查，不代表原生降级通过

## 隔离法则

模块替身只在单个测试内生效；所有网络必须显式 mock。集成测试只跨越证明契约所需的最小边界，平台下载与更新策略仍由各自纯函数或应用服务套件负责。

## M3/T11 测试先行边界

对照上游本地镜像 `b80885832b182330114326e540f3103df408463a` 的 `src/__tests__/harmonyInstallRecord.test.ts`：上游已测试共享内核薄绑定，本地仍由 ArkTS 持有记录解析与激活摘要复核，因此只吸收路径、错误码与激活边界的验证方法，不引入 seal/promote/checkActivation 接口或上游命名。VM 每例独立，实际解析、身份校验与摘要比较均来自本地生产源码；错误构造复用真实 ErrorCodes，文件替身记录路径与调用，摘要替身不代表真实 NAPI 或磁盘耐久性证明。

本地存在性判定不计算摘要，匹配 schema/version 但缺摘要的记录在存在性检查中可通过，激活必须拒绝；这两层语义不混为一谈。Harmony 修复轮仅让空文本/零字节文件返回内部历史 marker 对象，以引用身份区分非空 JSON `{}`；后者存在性返回 false，激活抛 completion record mismatch，不再被当成免摘要成功。磁盘协议、生成契约及原生接口不变，测试断言未改；当轮 Java/Apple 同类空对象绕过仍待修复，Apple 后续进展见下文，T11 不关闭。

本轮验证（2026-11-13，Windows/Bun 1.3.14）：改前重跑专项为 31 pass / 2 fail；修复后 `bun test src/__tests__/harmonyInstallRecord.test.ts` 为 33 pass / 0 fail、112 断言；`bun run test` 的 contract 10/10 通过，SDK 408 pass / 0 fail、1123 断言、26 文件，均退出 0。`bun run lint` 退出 0，Biome 52 文件无修复、SDK TypeScript、contract 只读校验和四端 19 方法 parity 通过；Harmony 类型检查因未发现 DevEco/OpenHarmony SDK 跳过，不计为原生验证通过。旧 Harmony `.ets` 安装记录套件仍直接信任裸 {} 且有空摘要构建的过时断言，未运行、不计通过。已检查父级 src/CLAUDE.md 与 SDK/根地图，无模块边界或生产接口变化，不扩大地图修改范围。

Apple 修复轮（2026-11-13，Windows/Bun 1.3.14）：先补提取 harness，在旧实现取得 29 pass / 6 fail，失败为三种非空空字典文本的存在性及激活绕过；仅收紧 reader 非空文件的字典非空条件后，35 pass / 0 fail、116 断言。零字节 marker 仍免摘要；schema 1 缺/错摘要、身份不符、不可读/无效记录与摘要不符仍拒绝；无 marker 的 current/last 豁免及 tvOS 路径/备份分支仅做静态保护。`bun run test` 退出 0（contract 10/10、SDK 443 pass / 0 fail，1239 断言、27 文件）；`bun run lint` 退出 0（Biome 53 文件、TypeScript、contract/parity），Harmony SDK 缺失仍跳过。未编译或运行 Objective-C++/Foundation/iOS/tvOS，不把替身 JSON/摘要或静态源码断言当成原生证据。仅修改 Apple 安装读取条件、harness 与两份局部地图；已检查既有 L3 与父级地图，无依赖/导出/职责边界变化，不改根规划，不关闭 T11。

T12（2026-11-13）：旧实现红测 1 pass / 6 fail；扩展后的专项 10 pass / 0 fail、143 断言。全量 `bun run test` 为 contract 10/10、SDK 453/453、1382 断言、28 文件；lint 通过，Harmony SDK 类型检查跳过。新清理旧键可读不等于覆盖安装旧原生包已验，删除不可恢复与物理回收差异见 scripts/contract-map.md。已复核三端既有 L3 的依赖/导出/职责边界无变化，不新增注释；局部地图与事实表同步。

T11 Apple 提交补验（2026-11-13，Windows）：先提取真实 commitRoundWithGeneration 并复用真实两层校验，修复前 39 pass/15 fail；15 项包含非法安装仍提交及成功激活未做摘要的失败断言，非提取器异常。加锁内 7 行守卫后 54 pass/0 fail、171 断言，覆盖普通/activation-only、错摘要/空摘要/错版本/空对象/无 marker/缺 bundle、零字节兼容、NULL 输出、cache-only、代际拒绝及 tvOS 开闭窗口/救援例外；拒绝断言同时检查写入日志与旧持久化值。全量 SDK 481/481、1463 断言、29 文件，contract 10/10；lint 通过（Biome 55 文件、tsc、contract/parity），Harmony SDK 缺失跳过。Python 提取器 8/8，真实 Apple 源码四份 .inc 提取成功。缺 Xcode/macOS Foundation，未编译运行 Objective-C++、iOS/tvOS、ASan/UBSan 或原生突变负控；替身控制流不等于原生锁/文件耐久性证明。tvOS 既有宿主已接真实安装校验依赖与 schema 1 夹具，不拆文件、不改下载续传，不关闭 T11。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

T15 Harmony（2026-11-13）：执行器先回放27/27后接真实宿主/NAPI；NAPI真实核对拍与安装累计227检查。最终contract10/10、SDK481/481、2718断言及强制SDK lint通过；Release HAR双ABI链接通过，设备未验，详见 ../../scripts/harmony-round-map.md。nativeHostApi当前执行真实入口+执行器，替换核心/IO；nativeConfiguration初始化既有串行队列，resumeDownload注入取消timer，不删除旧断言。

T11 Harmony 安装桥增量：原 33 项纯替身安装测试替换为真实 NAPI/共享核驱动套件，历史计数不直接可比。全量 SDK 449/449、contract 10/10，强制 DevEco SDK 类型检查及 lint 通过；共享核普通/ASan+UBSan 各 131/0。真实磁盘与摘要不再 mock，网络/zlib/空间仍是替身；OpenHarmony NAPI/HAR 链接及状态所有者集成未验。具体接口与集成清单见 scripts/install-map.md，前述 M3/T11 为历史阶段记录。
