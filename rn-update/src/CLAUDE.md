# src/
> L2 | 父级: ../CLAUDE.md

TypeScript 公共层。`index.ts` 只暴露稳定表面，`client.ts` 保留 Pakta 门面与实例可替换边界，六个 client 职责模块执行既有行为；`provider.tsx` 将该应用服务投影为 React 状态；`updateFlowCore.ts` 保持无 IO，供 JS 与原生实现共享同一决策语义。

## 成员清单

__tests__/: Bun 驱动的 JS/React 合约、纯决策向量、端点回退、遥测单次归类与 Provider 回归测试；子级 CLAUDE.md 维护套件地图
locales/: 中英文键值字典，由 `i18n.ts` 统一解析
CLAUDE.md: TypeScript 公共层的职责、成员与数据流地图
client.ts: Pakta 公开门面；拥有 options、loggerPromise、三个可写检查缓存字段、单例与 Provider 挂载约束；模块求值时调用状态工厂并向下载/激活注入同一状态，保留默认 Pakta 端点与公开箭头方法
clientActivation.ts: Activation 执行成功确认、切包、重启与重置；markSuccess 保留启动版本 expectedHash 与 accepted 门卫，进入原生前发布共享任务，拒绝/异常可重试，reset 成功使旧结果失去置位、上报与任务清理权限；切包代际与 watchdog 独立协调
clientCheck.ts: Checker 执行端点查询、请求校验、原生缓存匹配与设备灰度归一化；根响应缓存保存在门面，旧失败只清理自有 slot；固定 channel 与平台 body 形状，公开网络方法经实例动态调用
clientDownload.ts: Downloader 执行现有下载去重、进度广播、镜像/补丁降级及 APK 安装；下载成功 await 门面 report 后持久化 hashInfo，再发布 downloadedHash，不新增重入或单飞语义
clientNativeConfig.ts: NativeConfigSync 持有串行桥写入和最新待写配置；保留 nativeConfigSource 归属、不可变 channel、失效配置不覆盖原生救援与 JS 检查完成信号
clientReporter.ts: Reporter 持有事件/异常去重、错误监听和全局异常处理；从门面动态读取 options、loggerPromise、有效包版本与工作端点，保留遥测有界等待、失败吞并和本地错误分类
clientState.ts: createProcessState 纯工厂；每次调用分配共享容器、成功确认任务槽、切包代际与 watchdog 闭包，任务身份作为 reset 隔离凭据；不在职责模块求值时建立进程单例，保证 client 查询参数导入隔离
context.ts: React Context 边界；拆分低频更新状态与高频下载进度，避免无关消费者重渲染
core.ts: 原生桥接适配器；统一 TurboModule/旧桥、原生常量、不可变 channel、版本状态、设备标识与事件通道
endpoint.ts: 多端点执行策略；在纯候选排序之上实现 hedge、超时、失败聚合、单次检查总请求预算与胜者选择
error.ts: 跨 JS/原生稳定错误码与 UpdateError 归一化，保证日志和遥测不依赖本地化消息
errorReporting.ts: 自包含异常限长序列化与 ErrorUtils 处理器链安装/卸载，为 clientReporter 提供异常快照和捕获基础设施
globals.d.ts: Metro 注入的 `__DEV__` 全局类型契约
i18n.ts: 无外部运行时依赖的中英文翻译器与插值逻辑
index.ts: npm 公共出口，只重导出受支持的客户端、Provider、Context、桥、原生 channel/buildTime 诊断与错误类型
metadata.ts: 从 core 只读聚合启动 bundle 身份、安装摘要和救援来源，投影 tag/context 并适配 Sentry/Crashlytics，不引入第三方崩溃 SDK 依赖
NativePakta.ts: 本地桥方法事实入口与 Codegen Spec；T09 派生旧架构 Java Spec/Harmony 方法表并校验四端签名，保留 expectedHash 与 channel
provider.tsx: React 状态编排器；绑定客户端事件、自动检查策略、下载进度、提示和版本切换动作；无参切换优先目标已下载版本
telemetry.ts: 本地事件到服务端聚合事件、固定 channel/buildTime、目标 hash 与详情长度的纯映射规则
type.ts: 更新协议、结果、事件、配置与 Provider 测试载荷的共享类型模型
updateFlowCore.ts: 无 IO 的更新决策核心；负责 rollout、端点排序、带 channel 的请求体、结果解析、激活与下载策略
utils.ts: 平台断言、统一日志、超时 fetch、重试、进度和按服务端顺序的镜像探测等横切工具

## 数据流

`index -> client/provider/context`；`client -> clientCheck/clientDownload/clientActivation/clientNativeConfig/clientReporter/clientState`；职责模块通过 `Pick<Pakta, ...>` 声明所需门面，反向引用仅为 type-only，不产生运行时循环。Check 依赖 NativeConfig 和 Reporter，Download/Activation 依赖 Reporter 和注入状态；Reporter 用延迟回调读取 Check 工作端点。`client* -> updateFlowCore + endpoint + core + telemetry + error + type`；`core -> NativePakta/NativeModules`；`metadata -> core` 只读外泄启动身份，`errorReporting` 自包含。更新副作用留在 client 职责模块与 Provider，纯规则留在 `updateFlowCore`、`telemetry` 和 `error`。

M1/T05–T06 保持纯拆分；T07 独立增加成功确认单飞与 reset 旧结果隔离，为六个新增 client 职责模块补齐中文 L3 契约，不加普通注释。不引入上游无参成功确认、遥测 fire-and-forget 替换或原生缓存耗尽优化。公开字段仍由门面持有，职责模块不得缓存公开方法或 options 的副本，以保留实例替换语义。

T08 仅从 scripts/contract.json 派生 error.ts 的错误码联合/已知码集合及 endpoint.ts 的 hedge/请求预算声明，错误转换和网络执行仍由本层拥有，运行时不导入生成脚本或 JSON。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
