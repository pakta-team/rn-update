# tests/
> L2 | 父级: ../CLAUDE.md

成员清单

add-gitignore.test.ts: 凭据与构建目录忽略规则
api.test.ts: HTTP、会话、token 与错误整形
upload-progress.test.ts: standalone multipart 经共享传输发送流式请求体与按字节累计上传进度
app-info-zip.test.ts: ZIP 原生包元信息读取
app.test.ts: 应用选择、渠道命令、缺失渠道自动创建、standalone UUIDv7 与创建原生回退地址映射
auto-update.test.ts: CLI 自更新判定
bundle-options.test.ts: bundle 参数归一化
bundle-pack.test.ts: PPK 打包内容、压缩策略及输出目标不可写时及时拒绝且保留原目录
bundle-runner.test.ts: Metro/Hermes 编排
check-lockfile.test.ts: 包管理器锁文件识别
check-plugin.test.ts: Sentry 缺省、单/双平台配置检测，锁定 bundle 参数与单次本地化日志
cli-e2e.test.ts: CLI 命令入口端到端，覆盖非中文环境英文提示与认证失败引导；伪存储读完上传请求体再响应，阻断提前断连引起的 EPIPE 偶发
cli-options.test.ts: 参数白名单与解析
command-handlers.test.ts: 命令处理器映射
command-result.test.ts: 命令结果协议
commands.test.ts: 命令分组与调度
constants.test.ts: 品牌与服务地址常量
setup.ts: Bun 测试预加载，将兼容性回归固定在旧路由兼容模式；生产基址仍只使用当前服务
dep-versions.test.ts: 依赖版本采集
fs-helpers.test.ts: 文件系统原语与缓存目录
hash.test.ts: 流式 SHA-256 的空文件标准摘要、二进制多分块一致性与缺失文件错误传播
failure-fingerprint.test.ts: detail 脱敏保形、标识符全抹与 failureFingerprint 跨表达稳定的指纹契约
diff-hbc-transform.test.ts: HBC 差分转换
diff-integrity.test.ts: 差分完整性校验
diff-stream.test.ts: 流式差分边界
diff.test.ts: 通用差分行为
git.test.ts: Git 发布元数据采集
hbc-transform.test.ts: Hermes 字节码转换
hermes-base.test.ts: Hermes base 下载、缓存、字面量/指令等价校验、DefineOwnById `<str>` 折叠与脱敏指纹发布元数据
hermes-base-safety.test.ts: pretty 归一化不抹除语义空白、寄存器或分支目标的安全负例
hermes-blockers.test.ts: raw 函数完整性、零长度函数与 debug dump 进程清理回归
hermes-compile.test.ts: Hermes 编译一致性、失败降级与调试 dump 路径
hermes-fuzz-cli.test.ts: fuzz 脚本 ROUNDS 参数校验与退出码契约（无需 hermesc）
hermes-fuzz-literals.test.ts: fuzz 变异点全部落在真实字符串字面量边界内的回归
hermes-literals.test.ts: v87–96 split 与 v98/v99 shaped HBC 字面量缓冲区解码
hermes-metro.test.ts: 固定 SHA256 的真实 Metro HBC 自比与 base/plain 等价集成回归
hermes-raw.test.ts: 真实 Hermes 编译器下完整操作数、函数引用、常量、控制流、switch 表交换与 wide DefineOwnById 审计
hermes-review-regressions.test.ts: hermesFuzzSucceeded 终局裁决真值表回归（planted 漏检、compileErrors、空轮次）
hermes-switch-normalization.test.ts: Hermes 开关归一化
hermes-timeout.test.ts: Hermes 探测/验证期限、取消传播与异步错误收敛
http-helper.test.ts: standalone 服务地址与代理判定
i18n.test.ts: 国际化资源、中文 locale 识别、非中文英文兜底与中英文键集合对称性
latest-version.test.ts: T23 registry/auth/代理请求契约、scope 编码、fresh/stale 精确边界、强制刷新、跨 registry 隔离及 HTTP/JSON/网络/响应/超时失败回退；临时缓存与模块 mock 隔离，不访问真实 registry
native-package.test.ts: 原生包精简与重打包（保留 resources.arsc 基线）
non-interactive.test.ts: CI 非交互模式
options.test.ts: 通用参数读取
package-optimization.test.ts: 原生包上传优化
package.test.ts: buildTime 空白/非有限值原样字符串化、parseApp/Apk/Ipa JSON 剔除 bundle 字节、standalone 原生制品绑定、缺失渠道自动创建、精确重复短路与同版本换 JS 拒绝
provider.test.ts: Provider API 映射
resource-finder.test.ts: resources.arsc 资源表解析
runtime.test.ts: Node/Bun 请求与进程运行时
slim-sourcemap.test.ts: Source map 压缩归档
standalone-publish.test.ts: retry 单/多目标逐行 expectedRevision 与禁发 revision 契约；重复执行保持批次幂等身份且无制品创建或上传；模拟读取后任一目标 revision 过期时整批拒绝、错误透传且无部分写入，dry-run 零写请求并与实发 CAS 批次一致（不替代真实 Go/数据库事务验收）
sentry-upload.test.ts: 真实伪 sentry-cli 子进程验证单次 --help 探测、Debug ID 上传、能力缺失与失败时的 release 回退命令顺序，不访问 Sentry 服务
symbolicate.test.ts: 崩溃栈符号化
target-context.test.ts: app/platform/Hermes 目标上下文
upload-chunked.test.ts: GCS 分片并行上传、分片重试、拒绝短路与旧服务整文件回退
upload-request.test.ts: 真实 HTTP multipart/PUT 的 Content-Length、原始 ETag、取消/提前拒绝资源清理与错误传播
upload-standalone.test.ts: T22 uploadTimeoutMs 零/负值、整/跨 MiB、6 MiB 下限临界及 1 GiB 大文件预算；standalone 代理接入、失败分片流重建/进度回滚、零字节 PUT、重试耗尽期限和部分失败/管理失败的会话 complete/abort 契约
user.test.ts: 邮箱登录、退出与身份命令契约
utils.test.ts: 通用工具行为
versions.test.ts: 发布、绑定、独立服务交互投放与 pdiff 命令；锁定制品流式哈希不整文件读取、相同 SHA-256 去重复用及读取失败零写入
zip-entries.test.ts: ZIP 条目枚举、嵌套 HAP 清理及输出早期写失败无未处理 rejection，abort 不删既有目录
zip-options-file.test.ts: ZIP 选项文件解析
zip-range.test.ts: ZIP Range 定位与下载
zip-raw-writer.test.ts: ZIP 原始条目写入
fixtures/: 进程生命周期测试夹具；只供 Node/Bun 隔离验证，不进入生产包

渠道身份回归：app.test.ts 覆盖历史 Beta/beta 精确优先、歧义零创建与缺失 Beta 禁建 beta；package.test.ts 覆盖包原 channel、--channel 严格断言、唯一大小写兼容与歧义零上传/登记；standalone-publish.test.ts 覆盖 --channel/targets/channelId 和整批目标写前检查。负控旧实现三项失败；执行测试须沿用 package.json 的 --parallel=1 文件隔离，避免环境变量和模块 spy 跨文件串扰。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
