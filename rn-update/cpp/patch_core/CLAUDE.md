# patch_core/
> L2 | 父级: ../CLAUDE.md

归档补丁执行内核。规划函数保持无 IO；`patch_core.cpp` 执行补丁文件副作用，`install_record.cpp` 拥有完成记录与晋升 IO，`archive_limits.cpp` 拥有解压后目录审计。三端安装调用链已接入共享核，平台仍拥有下载、解压、状态锁和提交代际。

## 成员清单

CLAUDE.md: patch_core 的职责边界、成员与平台依赖方向地图
archive_patch_core.cpp: 实现 full/pdiff/diff 类型解析、条目分类、复制分组与文件源补丁参数装配
archive_limits.h: 消费 contract.json 派生的归档伤害上限 constexpr，供平台解压与空间守卫复用
archive_limits.cpp: 共享归档累计、精确压缩比、保留路径拒绝和解压目录审计，失败后累计器不可继续使用
archive_patch_core.h: 声明归档补丁类型、计划模型和从 manifest 到执行参数的无 IO 规划接口
digest.cpp: 实现流式 FIPS SHA-256、IEEE CRC32 及有界内存文件摘要
digest.h: 暴露 bundleHash 与 pdiff copy 源校验共用的 SHA-256/CRC32 原语
error_codes.h: 消费 contract.json 派生的原生稳定错误码，iOS 直接包含，Java/ArkTS/JS 对应声明同源生成
hbc_transform.cpp: 在完整结构校验后执行 Hermes HBC delta-friendly 正向/逆向原地变换
hbc_transform.h: 声明版本无关的 HBC 布局描述与可逆变换解释器
hbc_transform_wire.cpp: 严格解析受限 hbcTransform JSON，并以大小、深度和数量上限约束不可信输入
hbc_transform_wire.h: 声明 diffV 能力常量、wire 元数据模型、解析器与布局构建入口
install_record.h: 保留 contract.json 派生的 schema/记录名/staging 后缀，声明 Record、Seal/Promote、Activation 与文件身份复核
install_record.cpp: 完成记录有界解析、实际 SHA-256、临时文件 fsync/rename、目录晋升与激活快照复核；由 Android NativeInstall、Harmony install_napi 与 Apple 安装片段消费
patch_manifest.h: 声明本地 PatchManifest 解析接口，HBC 元数据单独输出以适配既有 FileSourcePatchOptions，不改本地模型
patch_manifest.cpp: 复用 flow_json 的显式限额解析 copies/CRC/deletes/HBC；校验失败保持输出不变，拒绝保留路径
jni_util.h: 提供 Android JNI 字符串、数组和 RuntimeException 的 header-only 公共适配
patch_core.cpp: 执行路径校验、文件复制/合并、HBC 变换域 hdiff、CRC 防线与旧版本清理
patch_core.h: 定义补丁 manifest、Status、BundlePatcher 抽象及共享文件执行公开契约
patch_core_android.cpp: 将 Android DownloadTask JNI 调用映射到文件源补丁与旧版本清理
resume_plan.h: 声明三端无 IO 续传请求规划、响应分类、严格 Content-Range 与 sidecar JSON 接口，sidecar 上限 64 KiB
resume_plan.cpp: 对照上游 resume_plan 迁入纯规则，复用本地 flow_json；保留 url/etag/lastModified/total 磁盘格式，不拥有网络、重试、预算和文件副作用
resume_plan_android.cpp: ResumePlan 静态 JNI 字符串桥，捕获 C++ 异常并返回 null 让下载失败而非穿越 JNI
state_core.cpp: 实现包体同步、版本切换、成功确认、回滚和冷启动解析的确定性状态转换
state_core.h: 声明跨平台热更状态、转换结果与无持久化 IO 的纯状态机接口
state_ops.h: 固定 Android/Harmony 共用且只能追加的状态操作整数协议
tests/: 宿主机回归测试与只读二进制 fixture，详见 tests/CLAUDE.md
update_core_android.cpp: 将 Android 生命周期 DTO 映射到 diffV、状态机、归档计划和 copy group 内核

依赖方向：`archive_patch_core` 只规划，`patch_core` 执行文件副作用；`hbc_transform_wire` 校验下载元数据后驱动 `hbc_transform`；平台 JNI 只做 DTO/异常映射。

T11 文件级契约与三端接线见 ../../scripts/install-map.md；安装核依赖本地 patch::Status、digest 和 flow_json，不依赖 resume。Android.mk、Harmony CMake 和 Apple Podspec 已登记安装源，平台下载器委托 manifest/归档/记录能力；生成分区与旧布局未因此迁移。源码接线不等同于三端设备或耐久性验收。

T08 仅生成 error_codes/archive_limits/install_record/state_ops/archive_patch_core/hbc_transform_wire 头中的常量或枚举分区；scripts/contract.json 是值的事实入口，算法、接口、JNI 与文件副作用不参与生成，生产代码不依赖脚本。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
