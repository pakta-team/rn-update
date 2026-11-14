# RCTPakta/
> L2 | 父级: ../CLAUDE.md

iOS 更新业务核心。RCTPakta.mm 同时承接 React Native 桥、状态/补丁共享 C++、无 JS 冷启动救援和无桥宿主 API；RCTPaktaDownloader 将网络字节可靠地流入受管归档，RCTPaktaNativeConfig 校验并快照宿主 options，头文件保持对外表面最小。

## 成员清单

RCTPakta.h: 声明 RCTEventEmitter/RCTBridgeModule 模块、bundleURL 选择入口与无桥 +configure/+checkAndUpdateWithCompletion: 类方法
RCTPakta.mm: 唯一生产编译单元，桥门面与原子提交入口，按顺序包含内部职责片段；保留 maxHttpAttempts 生成锚点并静态断言共享预算一致，RN 日志以 __FILE_NAME__ 避免嵌入绝对路径
RCTPaktaState.inc: 状态锁/代际、defaults 转换、选择性清理与进程下载登记；仅在主编译单元中实例化
RCTPaktaInternal.inc: 私有方法声明、进程轮次门闩、崩溃救援处理与 bundle hash 缓存，不暴露新宿主 API
RCTPaktaLaunch.inc: bundleURL 选择、回滚、configure 与无桥检查入口，保持原 tvOS 重解析路径
RCTPaktaIdentity.inc: 下载目录、包版本、opaque UUID buildTime、Info.plist 固定 channel
RCTPaktaInstallRecord.inc: 安装记录读取/激活摘要、空间与解压守卫，保留历史零字节 marker
RCTPaktaInstaller.inc: full/diff/pdiff 下载安装链，复用原文件队列与共享去重登记
RCTPaktaInstallerFiles.inc: 创建目录、解压及旧文件清理，保持运行版本保护
RCTPaktaNetwork.inc: 原生检查 HTTP IO/HTTPS 降级拦截与共享命令超时；tvOS Release 提供内核进程耗时和最多0.5秒网络路径预检
RCTPaktaOrchestrator.inc: 冷启动/无桥调度、tvOS 扣除进程耗时的12秒预算/2秒最小门槛、恢复窗口及崩溃延后激活，单进程轮次所有者
RCTPaktaRoundEngine.inc: StepRound 唯一命令循环与 env/http/install/download/commit 事件适配，不复制核心轮次策略
RCTPaktaDownloader.h: 声明带超时、进度和完成回调的单文件下载入口
RCTPaktaDownloader.mm: NSURLSession 流式下载器，请求/响应/sidecar 生成委托共享 resume_plan，保留 HTTPS 重定向拒绝、空间守卫与完整性检查；一次清零重试共享单调时钟绝对截止时间，未知长度成功后刷新 total
RCTPaktaNativeConfig.h: 无桥 configure 的归一化器声明（FOUNDATION_EXPORT，选项校验不触状态）
RCTPaktaNativeConfig.mm: Foundation JSON 边界直接委托共享 NormalizeConfiguration(..., true)，拒绝 channel；排序键输出快照，将捕获的 NSException 映射为 nil/可选 NSError(cn.reactnative.pakta)
CLAUDE.md: iOS 主模块的职责边界、共享内核依赖与成员地图

T08 仅派生 RCTPakta.mm 的 maxHttpAttempts 声明（当前 8），其余共享常量通过 C++ 头消费；不生成救援、清理、安装或桥方法。T09 从本地 NativePakta.ts 只读校验 Apple 导出签名及 markSuccess(expectedHash)，Apple 实现不作为生成物。

T11 在 PaktaReadInstallRecord 的非空文件分支拒绝解析后的空字典，保证只有历史零字节 marker 能进入免摘要兼容路径；不改变 schema 1、存在性不计算摘要/激活复核摘要、current/last 无 marker 兼容、错误码或 tvOS Caches/清理恢复。Windows 的 src/__tests__/appleInstallRecord.test.ts 提取真实 reader、文件存在性及两层校验函数，做受限语法转换后执行控制流，替换文件 IO、JSON/Foundation 操作和摘要；不是 Objective-C++ 编译、Foundation 运行或 Apple 原生 E2E 证据。

T12 的 PaktaClearVersionScopedState 在原状态锁内供 reset/二进制/渠道同步复用，只删 hash 前缀、first-load 标记与响应缓存；reset 额外删 package-updated 标记，升级/渠道仍置该标记。PaktaApplyStateToDefaults 负责旧布局状态及 rollback 清空，binaryChannel 写回当前包身份；uuid/nativeConfig/bundle hash/incomplete breadcrumb 与宿主 defaults 保留。文件队列、运行版本保护、tvOS 恢复及既有身份键兼容写入不变，未引入 suite/迁移/schema；受限转换 helper 回归不替代 Foundation/Apple 构建或安装降级验收。

T11 提交补验（2026-11-13）：commitRoundWithGeneration 在代际及 tvOS 窗口裁决后、任何 defaults/state 写入前，对实际 activation 复用存在性与激活摘要检查；失败 committed/activated 均为 NO，hashInfo/cache/state 零写。正常轮次和 responseText=nil 的崩溃救援共用守卫；历史零字节 marker 保留，窗口关闭且非救援时仍仅撤销激活，不拒绝元数据缓存提交。生产改动仅方法内 7 行；测试提取真实方法而非复制状态机，负控 39 pass/15 fail，修复后 54/54。既有 tvOS 原生宿主同步提取真实校验函数、链接 digest.cpp 并写入 schema 1 完整夹具；Windows 缺 Xcode/Foundation，尚未原生编译运行，不关闭 T11。既有 L3、父级及根地图已检查，无依赖/导出/模块边界变化。

T16：先以展开后翻译单元摘要证明职责提取无字节变化，再删除手写轮次接共享 StepRound；本地锁/窗口/expectedHash/channel/opaque 时间保留，不改 cpp。所有新增片段 <800 行，Podspec preserve_paths 保留但不公开/独立编译。证据、刻意保留差异及 macOS 未验边界见 ../../scripts/apple-round-map.md；此次不关闭完整 T16。

T16 预检续批：网络明确离线或剩余不足2秒不消耗轮次；网络等待计入进程预算，原锁内窗口/晚提交不接管/信号晚到重解析保持。真实提取14场景、4行为突变负控及无Mac边界见 ../../scripts/apple-round-map.md；独立tvOS target/Network.framework要求仅返回，不改Podspec。

T11 Apple共享安装接入：InstallRecord片段委托Read/IsComplete/CheckActivation，Installer委托原始manifest/HBC解析、Seal/Promote，解压委托累计器与目录审计。公共switch在锁外取摘要快照，锁内复核reset代际和current/last祖父身份；commit在锁外预检，窗口裁决后锁内Unchanged先于所有写入。既有tvOS/legacy/旧布局不变；无Mac原生编译结论。此前54项纯替身reader测试由真实核131检查、Podspec源闭包链接/3删源负控及生产commit提取测试替代，不能按计数直接比较。新增及变更文件契约集中见 ../../scripts/install-map.md 的Apple增量，不增加源码注释。

本次文档核对补共享轮次/安装片段的必需 L3，并修正 NativeConfig 委托事实；以上“不增加源码注释”为历史批次范围，不再作为当前头部缺失的豁免。不改算法、配置、测试或二进制，不重跑历史测试，不宣称 Apple 原生构建通过。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
