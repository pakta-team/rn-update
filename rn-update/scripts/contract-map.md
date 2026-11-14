# T08 地图增量与验收证据

父级地图：[CLAUDE.md](CLAUDE.md)。T08/T09 生成链成员与所有权已进入 scripts 地图；T12 的旧布局清理事实与运行证据见末节，早期验证不覆盖后续源码。

## 核心边界

本地 `contract.json` 是事实入口；`contract-schema.js` 验证结构、有限整数、唯一性与编号关联；`contract-targets.js` 声明文件/事实分区/唯一声明匹配/渲染内容；`generate-contract.js` 先完成全部预检，再仅写入变化的声明。生产代码不导入脚本或 JSON，原有符号名、方法、JNI、磁盘协议与副作用所有者不变。

118 个声明分区覆盖 23 个现有文件；每个分区恰好匹配一次，否则生成与检查均失败。分区外字节和文件原换行符保持不变；内容不变不写盘。`--check` 不修复、不写盘，漂移或结构错误以退出码 1 拒绝，正常退出 0。新增/改名事实必须显式修改 schema 与目标所有权，避免漏生成。

生命周期只记录当前平台键、reset、二进制/渠道变更与目录保护事实，不进入 targets，不生成执行代码。T12 已去除 Android 整库 clear，三端选择性清理仍由原聚合上下文拥有。schema-1 强 bundleSha256、历史空 marker、`.pakta-complete` 与 `.staging` 保持原语义。

## scripts 地图已登记成员

- contract.json：本地错误码、归档限制、状态/归档/任务编号、wire 版本、安装记录、端点预算、四 ABI 与生命周期事实；无凭据。
- contract-schema.js：事实完整性与约束校验，阻断未知/缺失事实、非法值和跨分区编号不一致。
- contract-targets.js：现有 C++/Java/TS/ArkTS/ObjC++ 常量声明的分区所有权与等值渲染；不拥有执行路径。
- generate-contract.js：工作目录无关的生成/只读检查入口；导出 generate 与 planGeneration 供临时目录负控复用。
- contract.test.js：独立 Node 回归；逐分区负控、损坏修复、缺失/重复声明失败、零写入检查、幂等与生命周期隔离。
- contract-map.md：本次地图增量、所有权说明与验收边界，不代替原生发布验收。

## 跨模块所有权语义

- `cpp/patch_core`：error_codes/archive_limits/install_record/state_ops/archive_patch_core/hbc_transform_wire 的常量值由本地 contract 生成，不再宣称 C++ 是手工镜像的唯一源；接口和算法职责不变。
- Android：ErrorCodes、ArchiveLimits、InstallRecord、DownloadTaskParams、UpdateContext 状态操作码、NativeCheckOrchestrator 请求预算纳入分区生成；文件 IO、JNI 和清理实现不变。
- Harmony：ErrorCodes、ArchiveLimits、InstallRecord、NativePatchCore、DownloadTaskParams、NativeCheckOrchestrator 的常量区纳入生成；ArkTS 执行代码和 NAPI 不变。
- TypeScript：error.ts 的联合类型/已知码集合和 endpoint.ts 的 hedge/请求预算由 contract 维护；公开 API 与行为不变。
- Apple：RCTPakta.mm 的 maxHttpAttempts 单条声明纳入生成，仍为 8；不改救援、清理、安装与桥方法。
- scripts：verify-android-so.js 的 ABI 名称/ELF machine/页对齐和 check-packlist.js 的 ABI 清单纳入生成；REQUIRED_SYMBOLS/JNI 验证保持原样。

上述语义用于逐项复核局部地图与头部，不再将 scripts 新成员列为未登记；其余未复核项不冒充全部完成。本次不新增代码注释。

## 复现命令与结果

在 `rn-update/` 执行：

```sh
node scripts/generate-contract.js
node scripts/generate-contract.js
node scripts/generate-contract.js --check
node --test scripts/contract.test.js
bun test src/__tests__/error.test.ts src/__tests__/endpoint.test.ts
bunx biome check src/error.ts src/endpoint.ts
bunx tsc --noEmit
node harmony/pakta/src/test/check-constant-parity.js
node scripts/check-native-spec-parity.js
node scripts/verify-android-so.js
bash scripts/test-patch-core.sh
bash scripts/test-update-flow-core.sh
```

早先单项记录：连续两次生成均 0 files；check passed；Node 10 项通过（含 118 分区逐项损坏/修复及 19 种非法事实输入）；Bun 27 项通过；Biome/tsc、24 项跨语言常量、19 项 Native Spec 方法及四 ABI 现有 SO 的 JNI/ELF/对齐校验通过。当前联合验证与 WSL 原始证据以以下登记为准，不把早先单项数量当作最终全量。

## 当前最终证据（2026-11-13）

- 主线程 SDK `bun run lint`、`bun run test` 本次复跑退出 0：Biome 51 文件无修复、tsc、contract --check、四端 19 方法校验通过；Node 契约 10 pass / 0 fail，SDK 375 pass / 0 fail、1011 断言、25 文件，包含 T09 幂等与漂移负控。Harmony 类型检查因缺 DevEco/OpenHarmony SDK 跳过，不计通过。
- `node scripts/check-packlist.js --release` 本次复跑：947 files OK。真实包 `TEMP/pakta-types-vAJfhe/rn-update-1.1.0.tgz` 的 SHA-256 为 `1dd49fa511fbf66043e6c551f145503db18790069777de3fee5c792abec2ec55`，归档核数 947 文件/23 份 d.ts；`node scripts/check-package-types.js <该包>` 复跑退出 0，实际加载 15 份 SDK 声明、相对闭包及错误输入拒绝通过，复核宿主 `TEMP/pakta-types-wlIJsl`。复用已安装第三方依赖并启用 skipLibCheck，不证明任意宿主兼容或原生编译。
- 当前 WSL 只读证据目录 `TEMP/t08-readonly-20261113`：`commands.jsonl`、`toolchain.log`、`patch-0.log`、`patch-1.log`、`flow-0.log`、`flow-1.log`、`script-adaptations.json`、`artifacts.log`、`files-before/after.json`、`summary.json` 均已读取/核对。Ubuntu WSL2 x86_64，GCC/G++ 13.3.0；17:11–17:12 的 SANITIZE=0/1、FUZZ=0 四次退出 0，普通及 AddressSanitizer + UBSan 均 patch 34/34、HBC 全通过、flow 111 向量及解析健壮性通过；逗号小数 locale 跳过。
- WSL 临时脚本仅替换 ROOT_DIR/BUILD_DIR，源脚本 SHA-256 分别为 patch `f2d2baa78cf2a3b35feccc6936bff4341b60efffef1cb2f26628eeb59f37af83`、flow `63634f874fb8cb1e66e8cf802cc7259c6ab6d6eb81a178e5eb2057b88353b8b7`；编译 flags 与测试源码不变。summary 记录 1363 项、changed_files=[]、status/diff/cached 前后一致；本次文档更新前再次比对该快照无差异。产物 Hash 见 artifacts.log；宿主 sanitizer 不等于 Android/Apple/Harmony release flags，更不等于真实 Hermes 编译器矩阵。

环境边界：早先 M0 环境阻塞保留为历史，不代表当前 WSL 核心仍阻塞。共享 C++ 编译仅有第三方 HDiffPatch 既有警告；FUZZ=0 与 locale 跳过明确保留。本次未重建四 ABI SO/HAR/Apple app，现有 SO 校验和 npm release 清单不能代称新产物构建；未执行 Expo Release、原生设备、真实 Hermes/Node18、Actions CI、Worker、实服验收或发布，不宣称 M2 全端或 M6 完成。

## T12 旧布局清理事实与降级边界（2026-11-13）

对照冻结上游 b808858 的 Android VersionScopedKeys、Apple RCTPushyState 与 Harmony UpdateContext：只吸收版本级清理和安装级保留，不引入 StoreSchema、新 suite/cache 库、迁移或生成执行路径；本地响应缓存仍在原库选择性删除。下载器、轮次实现、Worker 未修改。

| 生命周期 | 三端公共清理 | Apple 差异 | 安装级保护 |
| --- | --- | --- | --- |
| reset | 重置 current/last/firstTime/firstTimeOk/rollback；删 firstLoadMarked、响应缓存、hash 前缀；写当前包身份/channel | 额外删 package-updated 标记 | uuid、nativeConfig、按包身份索引的 bundleHashCache、incomplete breadcrumb、未知 KV/宿主 defaults |
| binary/channel | 同一 helper 删除首载标记、响应缓存、hash 前缀；状态由原 writer 重置/写回 | package-updated 仍置 true，incomplete 不再误删 | 同 reset；不白名单重建整库 |

目录集合不扩张：Android `_update`、Harmony 原 root、Apple 原 downloadDir；reset 沿原串行队列 maxAgeDays=0，保护运行 bundle 目录，Android 仍在执行时解析 current/last/launch keepnames。binary/channel 不新增同步全目录擦除：Android/Harmony 沿既有常规 age=3 天清理，Apple 沿既有启动清理策略；逻辑失效立即生效不等于目录立即全部删除，仍允许残留制品被后续流程重新选择/复用。三端原生清理失败回执差异保持：Android 入队后返回、Harmony 异步失败日志、Apple 文件队列完成后 resolve/reject；不宣称物理删除原子性。

Harmony getAllSync 缺失/抛错时，首载标记和响应缓存仍删、状态仍重写，未知 hash_* 留为孤儿；绝不退化到整库 clear。删除中途失败可留下部分元信息，未实现事务补偿。旧 schema/空 marker、库名、键名、目录与原 writer 不变；Apple 既有 prefixed identity 写入/legacy key 退休逻辑不扩改。

降级允许回内置包或重新下载，不承诺恢复已删 hash、缓存、首载/回滚状态及目录；保留的运行目录也只保护当前进程，不保证下次继续运行它。Harmony 三入口 VM 检查新清理结果仍可由旧键布局读取，不能替代“安装新实现→清理→覆盖安装旧原生包”设备试验；真实 Android/iOS/tvOS/Harmony 降级与崩溃/落盘故障注入仍待验。nativeConfig 原样保留，不擅自重写渠道配置；请求身份继续由原固定 channel 逻辑处理。

先红后绿：生产修改前新增七项回归，1 pass / 6 fail（Android clear 禁令失败，三端缺共享选择性 helper）；修复并扩展后 `bun test src/__tests__/versionScopedCleanup.test.ts` 10 pass / 0 fail、143 断言。Android/Apple 提取真实 helper 做受限语法转换执行删键控制流，入口连接与目录保护是静态断言；Harmony 既执行真实 helper 的枚举有/无/抛错分支，也 VM 执行完整 UpdateContext 的 reset/binary/channel，验证安装数据、旧状态和一次 flush。preferences/Foundation/文件队列均有替身，不是 JVM/Objective-C++/ArkTS 原生编译或真实磁盘耐久性证明。

本轮 Windows/Bun 1.3.14：`bun run test` 退出 0，Node contract 10/10、SDK 453 pass / 0 fail、1382 断言、28 文件；`bun run lint` 退出 0，Biome 54 文件、SDK TypeScript、contract --check 与四端 19 方法 parity 通过。Harmony SDK 类型检查缺 DevEco/OpenHarmony SDK 跳过。未重新 pack、重建 SO/HAR/Apple app、跑原生设备、Worker 或实服；旧 npm 候选不含 T12，T12 原生/降级验收及 M3/M6 不关闭。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
