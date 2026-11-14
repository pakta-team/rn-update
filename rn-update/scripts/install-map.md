# T11 安装共享核
> L2 补充 | 父级: CLAUDE.md | 2026-11-13

## 当前接线（2026-11-14，源码核对）

三端安装链均已接入 install_record、patch_manifest 和 archive_limits，并由 Android.mk、Harmony CMakeLists.txt 与 Apple Podspec 登记实现源；不是仅有宿主测试。Android InstallRecord/NativeInstall 经 native_install_jni 委托共享核，Harmony InstallRecord/ArchiveLimits 经 install_napi 委托共享核，Apple 安装片段直接调用 C++。公共切包与轮次提交均已消费激活快照；锁内 Unchanged、双代际和祖父身份的具体边界见各端增量，不推定三端锁模型完全相同。

轮次也已三端接线，配置归一化统一委托 native_config（fixedHost=true 拒绝 config.channel），详见 [flow-map.md](flow-map.md)。平台继续拥有网络、解压、空间守卫、目标清理、串行队列与状态持久化；共享核不提供断电事务或恶意并发写入隔离。本次仅读实现并补文档/必需 L3，不重跑下列历史测试、构建或设备验证，不修改算法、配置、测试、二进制及规划台账。

## 共享核迁入阶段所有权（历史）

先共享核、后原生桥：仅在初始迁入阶段，新实现只有宿主测试接入，当时未修改平台下载器/桥/构建清单。后续三端接线以下列增量及本页“当前接线”为准，不能把历史所有权当作当前缺口。

上游参考为本机 react-native-update/cpp/patch_core 的 install_record、patch_manifest、archive_limits；按本地 `pakta::patch::Status/PatchManifest` 适配，不迁入 pushy 命名、文本混淆或新依赖。向量为本地维护，不冒充上游全量对拍。

## 文件契约

| 文件 | INPUT → OUTPUT / POS |
| --- | --- |
| cpp/patch_core/install_record.h | 依赖本地 patch_core.h 的 Status 与标准类型；提供记录、封存晋升、激活与快照契约，当前已由三端安装适配消费；旧常量分区保持不变。 |
| cpp/patch_core/install_record.cpp | 依赖 digest、flow_json 与 POSIX 文件 IO；输出记录解析/原子写入、Seal/Promote、CheckActivation/Unchanged；不拥有状态锁、版本删除或下载行为。 |
| cpp/patch_core/archive_limits.h | 依赖现有生成上限与本地 Status；提供 EntryAccumulator、保留路径和解压目录审计接口。 |
| cpp/patch_core/archive_limits.cpp | 消费归档长度/条目元数据或解压目录；输出终止式累计裁决；不执行下载、解压或磁盘空间预留。 |
| cpp/patch_core/patch_manifest.h | 消费 JSON、本地 PatchManifestOptions；提供 ParsePatchManifest，HBC 单独输出给既有 FileSourcePatchOptions，避免给本地 PatchManifest 增加重复字段。 |
| cpp/patch_core/patch_manifest.cpp | 依赖 flow_json、ValidateManifest 与归档保留路径规则；输出本地 CopyOperation.expected_crc/deletes 与 HBC JSON；失败不改变任何输出。 |
| cpp/update_flow_core/flow_json.h / .cpp | 显式 ParseLimits 控制字节/节点上限；旧调用继续默认 1 MiB/65536 节点，深度上限仍为 64。 |
| cpp/patch_core/tests/install_core_test.cpp | 加载三个本地 JSON 向量并直接调用真实核心；输出检查数和非零失败码，文件操作发生于独立 /tmp 临时目录。 |
| scripts/test-install-core.sh | 使用宿主 C++17 与既有 hdiff/LZMA；编译真实核心测试，SANITIZE=1 启用 ASan+UBSan，不存在静默 skip。 |
| scripts/test-patch-core.sh | 原有 patch/HBC 验证之后执行安装测试；继承 SANITIZE，不修改 resume 测试。 |

迁入阶段曾仅在地图登记新增文件契约；本次补齐相关共享安装/轮次核心、JNI/NAPI 薄桥和执行器的必需 L3，并修正既有配置委托头部，不宣称全仓 L3 已补齐。

## 磁盘与完整性边界

- 固定 `.pakta-complete`、schema 1、`.staging`，`.pakta-` 路径分量在任意深度和两种分隔符下均为 SDK 保留；不扩展到其他产品前缀。
- 只有真实零字节普通记录文件是 legacy；`{}`、空白、null、数组、超限、错误 schema/版本均不允许走 legacy 激活。存在损坏记录时不能靠 current/last 祖父兼容绕过。
- IsComplete 仍是低成本去重检查，可识别命名正确但缺摘要的 schema1；CheckActivation 必须拥有真实匹配 SHA-256，不能把去重结果当作激活授权。
- Build/Write 拒绝非 64 位十六进制 bundle 摘要和无效输出；Seal 重算真实 bundle SHA-256，已知摘要只用于比对，不作为免验证捷径。artifactSha256 保持可选诊断字段，不作为激活依据。
- Write 使用唯一临时兄弟文件、完整写入、文件 fsync、rename，目录 fsync 尽力而为；拒绝用该接口新写 legacy marker。Seal 区分记录 IO 失败与 bundle/摘要失败。
- Promote 仅接受命名匹配的 sealed staging，不删除或覆盖已有目标；目标清理与串行安装锁仍归平台。重命名后 sync 父目录，不宣称断电全事务保证。
- Activation 保存 bundle 的设备/inode/长度/纳秒 mtime/ctime 与记录原文；所有 basis（包括祖父兼容）在提交前均要求文件快照未变。平台已接入状态锁内 Unchanged 再提交，具体见各端增量；这不是对抗恶意并发文件写入的完整文件系统隔离。
- 记录读取 O_NOFOLLOW/O_NONBLOCK/fstat，避免记录符号链接、FIFO 与读取时截断到零被误认历史 marker；bundle 本身必须是普通文件。

## Manifest 与归档边界

manifest 最多 16 MiB/80000 节点，记录最多 64 KiB/1024 节点。copies 接受空/null 同路径源及 Harmony 源前缀裁剪；CRC 必须为 uint32 整数，拒绝同源冲突。deletes 支持对象/字符串数组。HBC 选定条目必须是对象，有元数据但调用方不接收时直接失败，禁止静默丢弃。保留目录路径不得参与 copy/delete。

累计器覆盖 20000 条目、512 MiB 单条目、2 GiB 总量与精确 100:1 压缩比，乘法与加法均先守界，失败保持终止。解压后扫描不跟随符号链接，拒绝非普通文件和保留目录；文件与目录分别以 20000 限制扫描量，目录不纳入文件字节数。这是解压后审计，不替代平台解压前路径/空间检查；调用方须保证扫描目录在安装私有锁内不被并发替换。

## 共享核阶段历史验证

2026-11-13，Ubuntu WSL 实跑 `sh scripts/test-install-core.sh` 与 `SANITIZE=1 BUILD_DIR=/tmp/pakta-t11-sanitize sh scripts/test-install-core.sh`：各 124 checks / 0 failures；ASan/UBSan 无报告。C++ 源以 -Wall -Wextra -Werror 编译，既有第三方 C 源保留警告，不伪称第三方无警告。

补齐记录 IO 故障、目标拒绝覆盖、零字节 bundle、缺 bundle 与记录节点上限后，最终实跑 `sh scripts/test-patch-core.sh` 和 `SANITIZE=1 sh scripts/test-patch-core.sh`：既有 patch 34/34、HBC 全部通过，T11 各 131 checks / 0 failures；ASan/UBSan 无报告。日志位于 WSL `/tmp/pakta-t11-patch.log` 与 `/tmp/pakta-t11-sanitizer.log`。

`sh scripts/test-update-flow-core.sh`：111 flow vectors + parser robustness、671 native-flow assertions 通过；comma-decimal locale 未安装，该子检查明确跳过。`node scripts/generate-contract.js --check` 与 `node --test scripts/contract.test.js`：常量一致、10/10 契约回归通过。地图已回查 SDK、cpp、patch_core、update_flow_core、tests 和 scripts；根地图无顶级模块或架构增删，无需调整。

以上为共享核阶段历史；Harmony 安装桥增量及仍未集成的部分以下节为准。Android/iOS 桥、设备运行、真实断电、并发安装和新发布包不由本节历史证明。

## Harmony 安装桥增量

所有权限定为 Harmony 安装适配、DownloadTask、install_napi 独立头与回归/地图；不修改 UpdateContext、轮次、pakta.cpp、CMake 或共享核。已有工作区的九个安装导出及 install_record.cpp 编译登记沿用，不算本轮改动。SDK/根地图已检查，无顶级结构变化；SDK 地图的“仅宿主测试”是前阶段状态，本节是 Harmony 增量事实源。

| 文件 | 输入、输出与职责边界 |
| --- | --- |
| harmony/pakta/src/main/cpp/install_napi.h | 消费真实 install_record/archive_limits/patch_manifest；异步 Seal/Write/CheckActivation/目录审计，同步 Promote/完整性/保留路径/展开量/manifest。数值必须为安全非负整数；激活 external 持有原始路径和真实快照，校验环境归属，注册表受 mutex 保护。 |
| harmony/pakta/src/main/ets/InstallRecord.ts | 保留本地常量和兼容工具，记录 IO/激活校验委托 NAPI；verify 返回不透明快照，assertInstallActivationUnchanged 供状态提交所有者同步复核。 |
| harmony/pakta/src/main/ets/ArchiveLimits.ts | 常量仍由 contract 派生，空间探测仍归平台；展开量和目录审计委托共享核，目录审计显式接收实际压缩字节数，不再跟随 ArkTS stat 递归。 |
| harmony/pakta/src/main/ets/DownloadTask.ts | 原始 manifest 文本直接送共享 parser，避免无界 JSON.parse 先于核心上限；对象入口仅兼容旧工具测试。解压前查总量/空间，解压后异步审计，再走既有 patch、Seal、代际复核、Promote。 |
| harmony/pakta/src/main/ets/NativePatchCore.ts | 收窄九个既有安装接口和四个新增归档/manifest 接口，不扩大公共 RN Spec。 |
| harmony/pakta/src/test/install_napi_host.cpp | Node NAPI 宿主适配真实生产独立头，直接链接共享核；仅 NAPI 周边字符串/错误助手属于宿主，不复制安装规则。 |
| harmony/pakta/src/test/test-install-napi.sh | 编译并跑真实核 131 checks，再以 C++17/-Wall/-Wextra/-Werror 构建 PIC Node addon；需要 Node headers，可指定 NODE_INCLUDE_DIR，缺失即失败。 |
| src/__tests__/harmonyInstallRecord.test.ts | Bun 驱动 Ubuntu WSL/Unix Node addon，VM 执行真实 InstallRecord/ArchiveLimits/DownloadTask，真实文件及 SHA-256/Seal/Promote/快照；网络、zlib 和空间预留是替身，不代表设备。 |
| harmony/pakta/src/test/InstallRecord.test.ets / ManifestParsing.test.ets | 对齐强摘要与 NAPI 消息前缀、空源同路径规则；未运行 Hypium，不计设备通过。 |

新增源码不加注释；既有 L3 原文保留，变更后的依赖/导出/职责以本表和局部地图为准，不伪称所有 L3 已同步。

### 初始集成要求（历史，T15 已接入）

pakta.cpp 保留已有九个安装导出，追加以下四组 ExportFunction（本轮没有修改该文件）：

| NAPI 名 | harmony_install 回调 | 签名 |
| --- | --- | --- |
| installIsReservedEntry | Reserved | (name: string): boolean |
| installCheckUncompressedSize | CheckSize | (archive: number, expanded: number): void |
| installAuditExtractedDirectory | Audit | (directory: string, archive: number): Promise<void> |
| installParseManifest | Manifest | (text: string, normalizeResourceCopies: boolean): string |

CMake 的 HDP_SOURCES 还须增加 `${PATCH_CORE_DIR}/archive_limits.cpp` 和 `${PATCH_CORE_DIR}/patch_manifest.cpp`，staged native 路径也须携带对应头/源；install_record.cpp、digest.cpp、flow_json.cpp 已在当前清单中。完成前新增 ArkTS 调用在旧库上不可运行，类型检查和 -fsyntax-only 不能证明链接成功。

状态提交方须保存 await verifyInstallForActivation 的返回值，在既有串行状态锁内复核代际并同步调用 assertInstallActivationUnchanged，紧接持久化，不得在二者间 await；grandfathered 只能由 current/last 身份授予，不可由请求任意指定。下载方已有 assertInstallCurrent 回调必须由串行所有者传入；本轮不修改这些所有者，不宣称平台提交原子性完成。

错误边界：Seal 的摘要/缺 bundle、归档及 manifest 为 PATCH_FAILED；记录写入与 Promote 为 FILE_OPERATION_FAILED；激活与快照变化为 SWITCH_VERSION_FAILED。NAPI Error 保证消息前缀，code 属性由既有 toUpdateError 消费，不能假定原生 Error 自带 code。

### 实跑与未验

2026-11-13：普通宿主真实核 131/0；独立 `SANITIZE=1 BUILD_DIR=/tmp/pakta-t11-harmony-sanitize sh scripts/test-install-core.sh` 131/0，ASan/UBSan 无报告，日志 `/tmp/pakta-t11-harmony-sanitize.log`。真实 NAPI addon + ArkTS VM 最终 55 checks，覆盖封存晋升、拒绝目标覆盖、摘要篡改、非空空对象、legacy/grandfathered 快照、伪快照、参数边界、归档 symlink/保留目录/压缩比、manifest CRC/HBC、写入拒绝和 Seal 后失效不得晋升。

`bun run test`：contract 10/10、SDK 449/449（29 文件；旧 33 项纯替身安装测试由真实核驱动套件替换，计数不可直接比历史）。`bun run lint` 通过，显式 DEVECO_SDK_HOME 与 HARMONY_TYPECHECK_REQUIRED=1 的 Harmony 类型检查真实通过，非 skip；日志 `TEMP/pakta-t11-harmony-tests.log`、`TEMP/pakta-t11-harmony-lint.log`。DevEco clang++ 的 aarch64-linux-ohos/sysroot/C++17 对当前 pakta.cpp（含 install_napi）执行 -fsyntax-only 通过；不等于四个新增导出已登记或新库已链接。

未验：Harmony HAR 链接、OpenHarmony NAPI 设备运行、Hypium、真实下载/解压、断电/多安装并发、状态锁提交接入及新 npm/HAR 发布候选。宿主 addon 是 Node NAPI，不冒充 OpenHarmony VM/ABI 证据。DownloadTask 既有文件仍超过 800 行，未借此任务越界拆分网络/轮次模块。

禁区起止 SHA-256 一致：pakta.cpp `98da5d31c3a8f3c3d03785ede7fe249365e202ca9e3e09199ad7bf92a4a25429`；CMakeLists.txt `f1939a84456dcdccef1ab80995f5ca37c7ae29fd070f99a6c76692ef18dd6f81`；UpdateContext.ts `1a24305752127c583468f92affc41a51c09257d81c56491b8052b53bcb479860`。不提交，不同步发布二进制。

## T15 Harmony 集成回执

2026-11-13 后续集成已完成四个 ExportFunction、archive_limits/patch_manifest 编译登记及共享轮次三编译单元。既有 staging 复制整个 patch_core/update_flow_core，实际新 HAR 两 ABI 构建及链接检查通过，不再仅有 syntax-only。UpdateContext 的轮次提交与公共切包共用现有串行文件队列；保存真实 verifyActivation 快照，队列内摘要后复核双代际，紧邻写入同步调用 installActivationUnchanged，中间无 await。十三安装接口和旧布局保留。

上述“必须完成/未验/禁区hash”是 T11 历史边界，不再描述当前集成状态；最终验证为 contract10、SDK481、NAPI/核227检查、强制SDK lint及隔离Release HAR。精确契约、命令和仍未验设备边界见 [Harmony轮次地图](harmony-round-map.md)。

## Android 安装桥与调用链增量

2026-11-13，本轮只修改 Android 安装调用链、独立 JNI、构建/测试/发布库及地图；AndroidRound/DeviceRound、flow 核心、Harmony、Apple 不在本轮写入范围。进入时工作区已有大量未提交变更，不覆盖、不回滚、不提交。

### 文件契约与锁边界

| 文件 | INPUT → OUTPUT / POS |
| --- | --- |
| android/jni/native_install_jni.cpp | NativeInstall 字符串/long/条目数组 → 真实 install_record、patch_manifest、archive_limits；标准 UTF-8，拒绝 NUL，异常不越 JNI；快照句柄绑定原始目录/文件名/Activation，mutex 注册表显式 release，不从 Java 反序列化快照。 |
| android/.../NativeInstall.java | 包内静态 JNI 门面；execute 负责 build/write/read/complete/digest/seal/promote/reserved/manifest/audit，独立 checkActivation/unchanged/release/inspect；不扩公共 Spec。 |
| android/.../InstallRecord.java | 兼容常量/staging 与 JSONObject 投影；记录 IO/摘要/Seal/Promote 委托共享核，AutoCloseable Activation 保证所有提交出口释放快照。 |
| android/.../DownloadTask.java | 原始 manifest 文本先交共享 parser，再投影本地 copy/CRC/delete/HBC；full/diff 解压后审计，Seal 重算摘要；晋升由状态所有者在锁内复核任务创建时双代际与取消，不修改续传/HTTP。 |
| android/.../SafeZipFile.java | ZIP 元数据 → 有界数组共享累计器，任意深度保留分量委托共享核；Zip Slip、实际流式字节预算仍归平台。 |
| android/.../UpdateContext.java | versionFilesLock → commitLock 不变；摘要在状态锁外，公共切包/原生轮次紧邻 persist 前同步 Unchanged，祖父身份按锁内 current/last 重读；公共切包还比较摘要前后双代际。晋升前重验 sealed staging，锁内复核快照、双代际/取消并保护 running/current/last，目标删除仍归平台。 |
| android/jni/Android.mk / android/proguard.pro | 链接 install_record/archive_limits/patch_manifest 和独立 JNI；保留 JNI 创建的 FileOperationException(String)，不修改 flow 实现。 |
| android/build.gradle / scripts/test-android-install.sh | Windows Debug 测试前用 WSL Ubuntu/JDK17 编译真实生产 JNI；Gradle 编译类/运行依赖原样输入 Linux JVM -Xcheck:jni，缺工具失败。普通 Gradle 继续执行其余46项；Linux 可显式提供 TEST_CLASSPATH 运行脚本。 |
| android/src/test/.../SharedInstallBoundaryTest.java | 实现前短摘要、保留祖先两项负控；实现后真实 JNI 运行。 |
| android/src/test/.../SharedInstallNativeTest.java | Seal/Promote/Unicode、快照释放/伪造/篡改、legacy/祖父兼容、manifest CRC/HBC/deletes 与精确压缩比/目录 symlink 真实回归。 |
| android/src/test/.../InstallCommitTest.java | 实际 UpdateContext 方法和 JNI 状态核心，反射分配对象、SharedPreferences 代理；验证切包与轮次变更零commit/hash/cache/state、单次成功、双代际、祖父/损坏记录与 Seal 后失效零晋升。 |
| scripts/verify-android-so.js | 旧18入口加5安装入口，共23符号；四ABI架构、64位16KiB LOAD对齐继续守门。 |

新增源码未添加注释；现有L3原文保留，变更依赖/输出/职责以本表及局部CLAUDE为准，不宣称全仓L3已同步。L1无顶级模块增删，SDK/Android/JNI/Java/test/scripts地图已回查。

### 兼容性与错误

旧 `_update`、`update` SharedPreferences、`.staging`、`.pakta-complete`、schema1 均不变。只有零字节普通 marker 走 legacy；markerless 仅 current/last 祖父身份授权，存在损坏记录不能绕过。低成本 complete 不替代激活 SHA-256；legacy/祖父也必须文件快照未变。写入不再允许新建无摘要schema1，旧损坏夹具直接写磁盘模拟历史，不削弱生产写入。

Seal bundle/manifest/archive 失败走既有 PATCH_FAILED；Seal记录IO及Promote/失效/受保护目标走 FileOperationException → FILE_OPERATION_FAILED；激活拒绝维持 IllegalStateException → SWITCH_VERSION_FAILED。祖父身份锁内复核，但不宣称可对抗恶意并发文件写入或断电事务隔离。

### 先负控后实现与实跑

- 修复前 Gradle `--tests '*SharedInstallBoundaryTest' --offline` 两项均失败（短摘要被接受、保留祖先被放行），日志 `TEMP/pakta-t11-android-negative.log`。
- 增加5入口门禁后，旧四ABI全部因缺安装符号失败，日志 `TEMP/pakta-t11-android-so-negative.log`；随后才重建同步。
- 最终 `Example/e2etest/android/gradlew.bat :rn-update:compileDebugJavaWithJavac :rn-update:testDebugUnitTest --console=plain --offline`：41项Linux真实JNI/IO/提交测试 + 46项Gradle JVM（含28轮次回放/6取消），合计87项，0失败/错误/跳过；日志 `TEMP/pakta-t11-android-gradle.log`。宿主41项输出为JUnit文本，46项XML单独汇总，不将两者误报为同一XML。
- WSL `sh scripts/test-install-core.sh` 与 `SANITIZE=1 BUILD_DIR=/tmp/pakta-t11-android-sanitize sh scripts/test-install-core.sh` 各131 checks/0 failures，ASan/UBSan无报告；日志 `/tmp/pakta-t11-android-core.log`、`/tmp/pakta-t11-android-sanitize.log`。
- contract只读、19方法四端parity、Node contract10项通过；共享核未修改。
- NDK 28.2.13676358，android目录执行 `ndk-build.cmd -B -j8 NDK_PROJECT_PATH=. APP_BUILD_SCRIPT=jni/Android.mk NDK_APPLICATION_MK=jni/Application.mk NDK_OUT=../.tmp/t11-android/obj NDK_LIBS_OUT=../.tmp/t11-android/lib` 四ABI成功，日志 `TEMP/pakta-t11-android-so-build.log`。隔离verify通过后复制到android/lib并逐项比较SHA-256，再执行默认verify通过。

| ABI | 字节 | 发布库 SHA-256 |
| --- | ---: | --- |
| arm64-v8a | 451464 | `46ad90dc3adf714208db1802ddcf24b7d58a935208b50fa48facdc129434c4b4` |
| armeabi-v7a | 284408 | `1d7ccedd9834ede9fa63bd8813e0db822a8a2f70be4533c86cd0bceea0812962` |
| x86 | 437556 | `a054e533c163fabb3114ff301c128220d316660e1c877af65c0f7d71fbcb52ed` |
| x86_64 | 456264 | `2895ff816c0509b7e896293d56120bfd331d9eedc57b0d582248b7f82084de91` |

未验：Android设备/ART JNI、APK Release/R8、真实服务器下载、断电、并发安装压力与npm发布包。本轮LinuxJNI不是Android ABI运行证明；SharedPreferences/Android API为替身，真实锁下方法执行不等于系统存储耐久性。既有DownloadTask/UpdateContext超800行，未越界拆分网络/生命周期；后续若授权再作独立重构。

## Apple 安装增量

2026-11-13，仅写Apple安装片段、RCTPakta.mm的switch/commit安装守卫、Podspec及测试地图；不修改Launch/Orchestrator/Network/State/共享核心，保留并行T16变更，不提交。

| 文件 | 输入 → 输出 / 职责 |
| --- | --- |
| ios/RCTPakta/RCTPaktaInstallRecord.inc | NSString路径 → 共享Read/HasRecordFile/IsComplete/CheckActivation；dictionary仅为现有常量导出的投影。SSZipArchive元数据交共享EntryAccumulator，解压路径交保留分量检查。 |
| ios/RCTPakta/RCTPaktaInstaller.inc | 原始NSData manifest → 有界ParsePatchManifest及HBC元数据；Seal重算摘要，Promote不覆盖现存目标。目标删除仍归平台文件队列，状态锁内保护running/current/last，失败仅清staging。 |
| ios/RCTPakta/RCTPaktaInstallerFiles.inc | 成功解压目录及实际归档长度 → CheckExtractedDirectory；保留平台空间探测、Zip Slip/SSZipArchive及sidecar清理。 |
| ios/RCTPakta/RCTPakta.mm | switch锁外CheckActivation；锁内重读current/last、reset代际并Unchanged，紧邻切包。commit锁外预检，锁内代际/tvOS窗口后Unchanged，失败hashInfo/cache/state零写。 |
| rn-update.podspec | 显式登记install_record/archive_limits/patch_manifest的头及实现；片段仍preserve而非公开头/独立编译源。 |
| src/__tests__/appleInstallRecord.test.ts | 提取真实commit并受限转换，替换共享IO协作者，断言摘要锁外/Unchanged锁内、正常与activation-only零写、代际与tvOS窗口；静态检查switch祖父身份重读。 |
| scripts/tests/ios-purge-restore/test_install_link.py | 读取Podspec所有C++实现，用真实第三方C对象链接131检查；逐一移除三个安装源必须出现undefined reference。临时产物在系统TEMP，不写发布库。 |
| scripts/tests/ios-purge-restore/test_apple_split.py | 旧摘要保留；明确排除已授权改变的安装reader/verify/commit，启动/锁/下载登记仍受旧摘要保护；restore由并行T16行为测试负责。 |
| scripts/test-ios-purge-restore.sh | Foundation宿主增加install_record/flow_json链接源，提取原样生产方法；Windows不执行原生宿主。 |

非空`{}`不能走legacy；只有零字节普通marker允许免摘要。markerless祖父身份仅公共switch的current/last授权，轮次commit始终false；存在损坏记录不能靠祖父身份绕过。Unchanged比较真实快照，不在锁内重算摘要；不宣称恶意并发文件系统隔离。tvOS窗口关闭可丢弃激活而提交元数据，崩溃救援不能绕过失败快照。Seal摘要/manifest/archive失败PATCH_FAILED，记录IO/Promote失败FILE_OPERATION_FAILED，激活失败SWITCH_VERSION_FAILED。

实跑：`python -m unittest discover -s scripts/tests/ios-purge-restore -p 'test_*.py'`最终14项通过，包含131核检查、Podspec完整C++源闭包链接及3删源负控、34条真实轮次回放及救援标志负控、并行14预检场景；`extract.py ... .tmp/t11-apple-extract`成功。首轮遇到并行restore摘要漂移失败，未改编排或刷新旧摘要；并行T16行为测试接管该方法后最终通过。

最终`bun run test`为contract10及SDK439/0（31文件、2618断言），包含12项Apple专项；`bun run lint`通过，Harmony SDK未配置因此明确skip，非Harmony类型检查通过。日志TEMP/pakta-t11-apple-sdk.log及pakta-t11-apple-lint.log。旧54项reader替身回归由共享核+提交提取分层替换，计数不代表覆盖减少/增加的直接比例。

未验：macOS Objective-C++/Foundation/SSZipArchive运行、CocoaPods实际源裁剪及Xcode链接、iOS/tvOS设备/模拟器、真实下载解压/断电/并发压力。Linux C++链接仅证明共享源符号闭包，不是Apple编译。新增源码不加注释，文件契约集中登记本表；L1/SDK图检查无顶级架构变化，未越界写根图。

## Apple 归档 guard P1 修复（2026-11-14）

生产变更仅限RCTPaktaInstallRecord.inc与RCTPaktaInstallerFiles.inc，测试变更限test_install_link.py及本地图/测试CLAUDE；不改共享核心、Podspec、轮次、下载和发布产物。根/SDK/ios/RCTPakta/scripts地图已读取检查，无顶级结构变化，不刷新旧行为摘要。

| 文件 | 输入 → 输出 / 职责增量 |
| --- | --- |
| ios/RCTPakta/RCTPaktaInstallRecord.inc | initWithArchiveBytes消费实际归档长度，在delegate回调前初始化EntryAccumulator；默认成员0仅作构造占位，不再作为生产累计分母。既有条目数、单项/总量、symlink、保留路径及错误传播不变。 |
| ios/RCTPakta/RCTPaktaInstallerFiles.inc | RCTPaktaFileSize(path)的archiveBytes同时送guard初始化和解压后审计；原空间检查/清理/SSZipArchive调用参数不变。 |
| scripts/tests/ios-purge-restore/test_install_link.py | 平台参数接线及3组静态突变检查；从真实片段提取成员、初始化表达式与Accept调用，受限转换成C++宿主，链接真实archive_limits.cpp和patch_core.cpp的Status实现，未复制累计算法。段回收裁去未用补丁实现，不作为完整链接证据；完整闭包仍由原131检查及3删源负控负责。 |

先负控：原有测试首次暴露宿主编译缺口（symlink位移窄化/缺Status链接），修正后才记录行为证据。生产未修复时平台接线测试失败；真实C++运行明确失败于正常单项超过1MiB、累计超过1MiB及恰好100:1边界，其余拒绝检查通过。随后仅新增初始化方法并将真实archiveBytes送入。

最终guard 10项检查覆盖：单项超过1MiB、压缩归档长度2MiB且展开3MiB、两条累计超过1MiB、恰好1MiB、恰好100:1均通过；累计超过100:1、单项zip bomb压缩比、symlink、超过512MiB单项及零归档分母均拒绝。平台参数归零、退回new及累计器分母归零静态负控均命中；另两组C++归零突变必须成功编译并以退出码1/指定正常单项与累计失败消息被捕获，不把编译错误当行为命中。

实跑命令与结果：
- `python -B -m unittest discover -s scripts/tests/ios-purge-restore -p 'test_*.py' -v`：16/16通过，包含131安装检查/3删源负控、34轮次轨迹与救援负控、14预检场景/4行为突变及上述guard回归。
- `bun run test`：contract10/10、SDK439/439，31文件/2618断言；`bun run lint`通过，Harmony SDK未配置而明确skip，不计Harmony类型检查通过。

验证只覆盖源码参数接线、受限提取及Linux真实C++元数据裁决，不是实际ZIP解压测试，更不代表Foundation、SSZipArchive、CocoaPods/Xcode或Apple设备通过。未运行Apple原生宿主，未提交/发布；新增源码无注释，文件契约登记于本节，既有L3不伪称已补齐。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
