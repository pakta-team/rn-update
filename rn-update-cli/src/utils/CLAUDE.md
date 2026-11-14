# utils/
> L2 | 父级: ../CLAUDE.md

CLI 基础设施与原生包解析。`index.ts` 读取三端固定 channel/buildTime；`http-helper.ts` 固定当前 Go API 服务基址并保留测试用路由兼容判定；`constants.ts` 隔离品牌、API 服务地址、前端价格页和凭据文件。

成员清单

CLAUDE.md: CLI 基础设施成员与依赖方向地图
add-gitignore.ts: 仅对现存项目 .gitignore 幂等补入 CLI 凭据与临时目录，识别等价目录规则
check-lockfile.ts: 沿项目与 workspace 边界只读检查多份锁文件，提示构建依赖不一致风险
check-plugin.ts: 并行探测 ios/android 的 sentry.properties，为 bundle 编排启用 Sentry 与 source map
command-result.ts: 将异步任务的未知异常收敛为 CommandResult，保留上层成功映射与稳定错误出口
dep-versions.ts: 按 cwd 惰性读取并缓存项目直接依赖版本，供版本提示与构建诊断消费
git.ts: 通过无 shell 的 Git 子进程只读提取提交与 origin，供发布元数据使用
i18n.ts: 按显式环境、POSIX locale、系统 locale 选择中英文资源，统一 CLI 文案翻译
options.ts: 统一环境开关及布尔、字符串、可选字符串和逗号列表参数读取，不承载业务决策
runtime.ts: 统一 Node/Bun 运行时、包管理器、代理感知请求及子进程启动，供上传与构建复用
slim-sourcemap.ts: 规范化项目内源路径并裁减依赖内联源码，提供 gzip 归档和透明解包；无法安全精简时保留原 map
index.ts: APK/AAB/IPA/Harmony 元数据读取及 bundleHash 计算，buildTime 保持不透明字符串并读取固定 channel
app-info-parser/: 原生归档格式边界，提供 ZIP 扫描、APK manifest/资源引用、IPA plist、AAB 转 APK 与 binary XML 解码，不再导出旧 Parser 类或图标链
constants.ts: 品牌常量、当前 API 服务端点、Pakta 前端价格页、服务地址哈希凭据路径
http-helper.ts: 独立服务判定、测试用健康探测与 URL 解析
fs-helpers.ts: 平台缓存目录与 plain node:fs 文件系统原语（remove/ensureDir/emptyDirSync/moveSync），替代 fs-extra 子集
hash.ts: sha256Hex 内存内容/幂等键指纹与流式 sha256File 文件指纹，供差分、Hermes 缓存及 standalone 发布制品去重共享
zip-entries.ts: node:fs 与 fs-helpers 管理 ZIP 条目读取、写入、前缀读取和枚举，显式维护文件写偏移避免 WSL 挂载盘首块被 writev 覆盖，统一临时目录生命周期
zip-options.ts: 依据魔数、扩展名和条目类型选择压缩策略，避免对已压缩资源重复 deflate
zip-range.ts: 从 ZIP 定位 bundle 并按 HTTP Range/If-Range 有界读取远程条目，协议异常交调用方回退完整下载
zip-raw-writer.ts: 按源条目 CRC、大小与时间戳直接复制压缩字节，显式维护文件写偏移，限制为非 ZIP64 归档并在失败时清理输出
latest-version.ts: npm registry latest dist-tag 查询与按 registry 隔离的元数据缓存，替代 @badisi/latest-version
upload-request.ts: 精确 Content-Length 的代理流式 multipart/PUT 单次传输，取消/失败/响应时停止请求体并清理取消监听，原始 ETag 供 standalone complete 使用；重试与期限由 api.ts 管理
hbcTransform.ts: HBC 版本布局探测、段范围解析与可逆 delta 字段变换，供差分和 Hermes 字面量读取共享
failure-fingerprint.ts: redactFailureDetail 脱敏（str/fn/path 哈希 token）与 failureFingerprint 分组指纹（SHA-256 前 16 字节），全仓唯一实现，上报与 fuzz 去重共享
hermes-base.ts: Hermes base 选择/缓存/下载与 pretty+raw 二阶段语义等价校验，下载/审计文件显式维护写偏移；reportedBytecodeVersion 把纯 JS 上报为 0，DefineOwnById* 字符串操作数折叠 `<str>` 交给 raw 审计，上报 detail 经 failure-fingerprint 脱敏并附指纹，失败统一降级并生成发布诊断
hermes-cached-object.ts: normalizeCachedObjectInstruction 将 CacheNewObject 的 shape 索引解析为有序属性键 JSON，寄存器与 cache 索引保留，无法解码时 fail-closed
hermes-literals.ts: 解析 v87–96 split 与 v98/v99 shaped HBC 字面量缓冲区，按指令还原数组/对象语义，非法引用 fail-closed
hermes-raw.ts: 从 HBC 完整二进制与 raw dump 恢复字符串、常量、函数头、引用和 switch 目标，供最终等价审计消费
hermes-timeout.ts: 校验正整数且不超过 Node 上限的超时毫秒值，作为 Hermes 子进程的共享期限策略

法则: 原生身份来自包内固定字段，opaque buildTime 不解析

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
