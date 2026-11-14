# src/
> L2 | 父级: ../CLAUDE.md

CLI 命令、服务端适配与原生包身份解析。`api.ts` 是唯一 HTTP/上传边界；`app.ts` 管理应用和渠道；`package.ts` 登记原生构建；`versions.ts` 发布渠道版本组；`utils/` 只提供解析和基础设施。

成员清单

CLAUDE.md: CLI 命令层成员与业务边界地图
account-worker.ts: detached 账号快照刷新进程，在期限内读取会员接口并以隔离权限原子更新缓存
account.ts: 常规命令的账号与续费提示，优先消费按 cwd/token 隔离的缓存并派发后台刷新
cache.ts: Hermes base 缓存统计与显式清理命令，具体路径和回收规则委托 utils/hermes-base
commands.ts: 惰性命令注册表，仅在调用时加载相应业务组，减少入口依赖与启动开销
exports.ts: 包级公共 API 聚合出口，保持会话、应用、差分、Provider 与公开类型的导入契约
install.ts: 校验依赖包参数后委托当前包管理器安装，拒绝 shell 元字符，不直接修改发布模型
bundle.ts: bundle 命令编排入口，组合参数、应用选择、runner、PPK 和发布，不承担压缩或传输实现
bundle-pack.ts: PPK 归档边界，复用 ZIP 压缩策略将已生成的 bundle 目录打包，不运行 Metro 或上传
symbolicate.ts: 根据服务端版本 source map 将 bundle 栈映射回源码，兼容压缩归档与本地读取
api.ts: 会话认证、旧服务兼容请求、独立 Go API 管理路径、CLI 会员权益与 Hermes base/渠道边界；上传统一代理、按分片大小限定期限、重试流重建和进度回滚，GCS 保持并行与旧服务整文件回退，standalone 保持串行 PUT、对象/会话定位及原始 ETag complete/失败 abort 语义
bin.ts: Pakta 进程入口，统一参数解析、会话恢复、动态命令分发、顶层错误输出与本地化过期构建提示；四个 parseApp/Apk/Ipa/Aab 命令跳过账号 worker、版本提示及自更新，使 stdout 只有 JSON；源码仓库中的 src 比 lib 新时立即拒绝执行并要求重建，防止旧编译产物写入旧发布模型
app.ts: 应用选择/CRUD、渠道 CRUD 与缺失渠道幂等创建，持久化 appId/appKey；独立服务创建时把 downloadUrl 映射到 default 渠道 nativePackageUrl（遗留数字服务保持数字 appId 契约，独立服务支持 Go 服务生成的 UUIDv7），渠道命令输出统一走本地化资源
bundle-runner.ts: 运行 Metro/Hermes bundle、选择和验证 Hermes base，并安全清理中间目录
native-package.ts: 原生包上传前的 ZIP 精简与差分条目规则，只保留 JS bundle 和资源基线
diff.ts: 本地 HDiff 命令，将旧 PPK 或 Android/iOS/Harmony 原生基线与目标 PPK 转为补丁，复用 ZIP 内容比较与 Hermes 变换；普通发布不自动调用，生成后需另行上传登记
package.ts: Android/iOS/Harmony 包解析、channel 自动创建/严格断言；上传/精简和渠道创建前先读取独立服务会员权益并按原始文件字节预检（Harmony .app 递归计数），随后把精简包 packageKey/downloadUrl、ZIP Range 元数据与 HBC 版本（纯 JS 为 0）绑定到原生版本（保留包内 channel），parse* 输出剔除 bundle 字节的 JSON，校验错误使用中英文资源
versions.ts: 命令入口与旧版本绑定兼容，委托独立服务投放编排和版本查询操作（目标 rollout 优先于全局值，默认 100%），发布元数据上报 reportedBytecodeVersion
provider.ts: 公共 CLIProviderImpl 入口，把 PublishOptions 的 targets、rollout、准确 Deployment ID 与其它发布参数完整转为命令上下文；消息与数据命令共用会话初始化/错误整形边界
auto-update.ts: 后台自更新与包管理器检测，复用 fs-helpers 用户缓存路径、options 环境开关及 runtime 包管理器类型，保留原类型导出路径
version-operations.ts: 旧版本查询、依赖变更提示、原生包绑定和数字服务版本选择，维持兼容 API
standalone-publish.ts: full 制品上传为 immutable UpdatePackage，交互模式在上传后选择原生构建并可只登记不投放，显式目标按 targets.json 创建/复用独立 Deployment 后原子批量发布；准确 deployment ID 重试读取各目标 revision，仅以 expectedRevision 发送 CAS 前置条件而不发送 revision，每次只提交一个批次，重复执行复用同一目标集合的幂等键、透传冲突且不重复上传，dry-run 只读并输出同一 CAS 命令；另负责逐构建 pdiff 登记（渠道 code 精确优先、唯一大小写兼容）
types.ts: CLI 公共模型，兼容旧数字 ID 与独立服务 UUID
locales/: 中英文交互资源，键集合保持对称；仅中文 locale 选择 zh，其余 locale 与缺失翻译统一回退英文，覆盖渠道、上传、投放和 pdiff 错误反馈
user.ts: 统一邮箱账号登录、注销和当前身份查询，复用管理 API 会话与个人令牌边界
utils/: 包解析、常量、服务地址、文件系统/哈希/传输原语与命令辅助工具
utils/fs-helpers.ts: 平台缓存目录与 plain node:fs 文件系统原语，替代全部生产 fs-extra 调用，原生包命令共用 remove 清理临时目录
utils/hash.ts: sha256Hex 内存内容/幂等键指纹与流式 sha256File 文件指纹；standalone 发布去重按制品原始字节流计算 SHA-256，不改变内容身份
utils/latest-version.ts: npm registry latest dist-tag 查询与按 registry 隔离的元数据缓存
utils/upload-request.ts: 精确 Content-Length 的代理流式 multipart/PUT 单次传输，共用取消/失败清理并透传原始 ETag，供 standalone 与旧服务/GCS 上传消费
utils/hermes-literals.ts: 解析 v87–96 split 与 v98/v99 shaped HBC 字面量缓冲区，按指令还原数组/对象语义并对非法引用 fail-closed
utils/hermes-raw.ts: 从 HBC 头、完整字符串/常量表和 raw dump 恢复语义操作数，审计函数体、引用与控制流
utils/hermes-timeout.ts: 统一校验 Hermes 探测、编译和等价验证的环境/调用方超时值，拒绝无效定时器期限
utils/slim-sourcemap.ts: 归档 source map 的跨平台路径归一化、依赖源码裁剪与 gzip 解包

渠道身份边界：app.ts 的 findChannel 为上传、显式 target 和交互筛选共用只读解析器，精确 code 优先，仅无精确命中时允许唯一大小写兼容；歧义拒绝，不依赖列表顺序。package.ts 保留包内 channel 大小写，--channel 严格断言原值。standalone-publish.ts 先对整批目标完成渠道/版本/rollout 预检，再创建缺失渠道，避免后续歧义留下前序写入。服务端创建接口强制小写，故缺失混合大小写身份在 CLI 写前失败，不自动创建替代身份；已有历史 Beta/beta 按原 code/ID 解析，兼容命中不改包内值。

法则: 业务命令不直接拼 HTTP 细节；独立服务不回退上游默认地址

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
