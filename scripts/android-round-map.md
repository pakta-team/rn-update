# T15 Android 共享轮次接入
> L2 | 父级: CLAUDE.md；验证日期：2026-11-13

## 所有权

NativeCheckOrchestrator 保留冷启动延时、JS 已检查去重、宿主 API 和崩溃救援的进程单飞门，实际轮次交给 AndroidRound。AndroidRound 仅执行 pakta::updateflow::StepRound 发出的命令并回传事件；DeviceRound 将端口接到既有 UpdateContext/OkHttp/DownloadTask。旧 runOnce/runConfiguredRound/runCheckRequest/performAttempts 已移除，不保留第二套策略路径。

宿主 PaktaNativeUpdate 的 configure/checkAndUpdate、回调线程与 NativeUpdateResult 五状态不变，NativeUpdateConfig 仍执行现有白名单归一化，不开放 config.channel。请求只读取 Manifest channel，buildTime 不做数值转换，启动回滚快照在延时检查前采集。响应缓存仍为 ts/body/request/config，时戳锚定响应到达，不因下载结束刷新。

配置等价/可运行门禁和等待后的 HostCancellation 使用共享纯核；AndroidRound 通过 DeviceRound 消费 UpdateContext 在同一 commitLock 内采集的配置/reset/config 快照，避免配置写入先推进代际、尚未持久化时形成新代际配旧配置；A→B→A 不靠文本相等放行。IO 前和下载等待期间检查失效；HTTP watcher 每 25 ms 取消在途 Call，取消标记保持到端口生命周期结束，避免 Call 注册竞态。下载超时/取消调用既有 task.cancel，不改下载器内部。

commitNativeRoundResult 继续在 versionFilesLock → commitLock 的既有顺序下执行摘要门禁、双代际复核与一次 SharedPreferences 提交，不增加锁或换库。锁内提交回执交回共享核，不被外层取消覆盖；宿主等待结束仍复核三份配置和双代际。下载后留给 JS 的版本若遇崩溃救援，延迟激活也携带下载时的两代际，不能跨配置重配激活旧结果。

HTTPS 降级拒绝仍调用 DownloadTask.rejectProtocolDowngrade，响应仍硬限 1 MiB；端点请求上限及增量/full 独立预算由共享核负责。contract.json 不变，既有 Android 请求上限声明保留供生成校验，不再控制另一条手写回退路径。安装、续传、归档和资源复制不在本任务修改范围。

## 文件契约

| 文件 | INPUT → OUTPUT；职责与依赖方向 |
| --- | --- |
| android/src/main/java/cn/reactnative/modules/update/AndroidRound.java | JSON state/command、注入时钟/宿主 → JSON event/Outcome；执行而不决定策略，finally 清除 breadcrumb，异常交进程门卫折叠 |
| android/src/main/java/cn/reactnative/modules/update/DeviceRound.java | UpdateContext、启动回滚快照 → 环境、真实 HTTP/下载/原子提交；固定渠道和双代际在平台端获得 |
| android/src/main/java/cn/reactnative/modules/update/NativeCheckOrchestrator.java | 冷启动/宿主/救援触发 → 每进程一轮；只保留调度、安全 HTTP 和待激活救援，不复制共享策略 |
| android/src/main/java/cn/reactnative/modules/update/NativeUpdateFlow.java | 包内 JSON 调用 → 原有四入口及新增 stepRound/runnableConfig/configsEquivalent/hostCancellation；不扩展 RN Spec |
| android/src/main/java/cn/reactnative/modules/update/ErrorCodes.java | Throwable 类型 → DOWNLOAD_FAILED/PATCH_FAILED/FILE_OPERATION_FAILED；与 UpdateModuleImpl 共用，常量生成分区不变 |
| android/jni/native_round_jni.cpp | Java 字符串/long → pakta::updateflow；标准 UTF-8 双向转换、局部引用释放、异常不越 JNI；不读取磁盘或时钟 |
| android/jni/Android.mk | 原有 flow 源加 native_config/native_round/round_engine/native_round_jni → 四 ABI rnupdate；Gradle 继续打包 android/lib |
| android/src/test/java/cn/reactnative/modules/update/SyncRoundReplayTest.java | 冻结 round-engine-vectors 的命令和下一事件 → AndroidRound 真实执行回放；28 条 Android 可产生轨迹，验证命令入参、代际、时钟、结果及 breadcrumb |
| android/src/test/java/cn/reactnative/modules/update/AndroidRoundCancellationTest.java | 受控代际变化/未完成任务 → HTTP/下载取消、配置提交拒绝和异常回收六项；使用 latch 和真实等待，不靠无限 sleep |
| scripts/verify-android-so.js | ELF → 架构/18 个 JNI 符号/64 位 16 KiB 对齐断言；新增四个入口可阻断旧库发包 |

新增文件头契约集中登记于本地图，本任务未新增源码注释。既有源码头未全部同步，不宣称全仓 L3 维护已完成。

## 先回放后验证

进入时工作区已有未完成 T15：AndroidRound/DeviceRound/NDK 清单和 startRound 调用已存在，但缺配置 JNI 声明，旧手写轮次仍调用失配 HTTP 签名，ErrorCodes 分类入口也缺失。未覆盖这些既有变更，先补回放和编译所需最小修复；28 条回放通过后补齐 JNI、取消专项与发布符号门禁，最后全量构建。

回放的引擎由向量脚本替身提供，IO 从下一事件注入，因此证明的是 Android 适配器执行契约，不是实际 C++/JNI 调用。排除的上游轨迹包括协议错误、Apple forceActivate/activated 覆盖和 Android 不产生的无错误码失败；不把它们计作 Android 通过。超时回放区分命令执行前时钟与完成时钟，不以已过期时钟假装任务已入队。

- `Example/e2etest/android/gradlew.bat :rn-update:testDebugUnitTest --tests '*SyncRoundReplayTest' --console=plain --offline`：28/28，日志 `TEMP/pakta-t15-replay.log`。初次编译失败和中间回放失败已修复，不作为成功证据。
- 同目录 `gradlew.bat :rn-update:compileDebugJavaWithJavac :rn-update:testDebugUnitTest --console=plain --offline`：生产 Java 编译成功，XML 汇总 **73 tests / 0 failures / 0 errors / 0 skipped**（既有39 + 回放28 + 取消6），日志 `TEMP/pakta-t15-gradle.log`。
- WSL Ubuntu `sh scripts/test-update-flow-core.sh`：既有111 flow向量/解析健壮性及新增688断言全部通过；locale 缺失跳过，本任务未重跑 sanitizer。
- `node scripts/generate-contract.js --check`、`node scripts/check-native-spec-parity.js` 和 `node --test scripts/contract.test.js`：通过，19方法四端签名一致，10契约回归通过；不代表其他平台编排已迁入。
- Windows NDK **28.2.13676358** 在 android 运行 `ndk-build.cmd -B -j8 NDK_PROJECT_PATH=. APP_BUILD_SCRIPT=jni/Android.mk NDK_APPLICATION_MK=jni/Application.mk NDK_OUT=../.tmp/t15-android/obj NDK_LIBS_OUT=../.tmp/t15-android/lib`：四ABI全量成功，日志 `TEMP/pakta-t15-so-build.log`。
- 隔离目录 verify 通过后复制四ABI至 android/lib，逐项比较 SHA-256 一致，再运行默认 `node scripts/verify-android-so.js` 通过。18 个所需 JNI 导出、四个 ELF machine 与64位 LOAD≥16384 均检查。

| ABI | 字节 | 发布库 SHA-256 |
| --- | ---: | --- |
| arm64-v8a | 406864 | `430e7197a4e46182958633c5ffcc04c6e0ccf4824fc930db29cf1ef094d86fb9` |
| armeabi-v7a | 254872 | `4ac2f67a0878260d9dee039b7b02db805e6535c7f9c4f98256f28db72cf33b86` |
| x86 | 388908 | `23a4fc1822d8677b285d11e6b0af59017dd9a70b4926de958eeedefda890e1330` |
| x86_64 | 411136 | `99f40ce3f563f7b6c93726d7dce5266cc83b1f282367f09054de1c4771a24110` |

## 未验边界

未运行设备、APK/Release/R8、真实宿主 API/HTTPS 服务器、JNI Unicode 运行或系统崩溃恢复；JVM 回放替换引擎与 IO，真实锁仅静态核对，不能声称竞态设备验收完成。四 ABI 编译/符号检查不替代 JNI 运行证明。Harmony/Apple 编排未改，未发包、未提交，不宣称 T15 全平台/M4 完成。

## 首启收尾（2026-11-14）

本轮只修改 FirstLoadTest、UpdateContext 首启回调的一行接线及本地图/Java/test 局部地图。进入时 FirstLoadTest 为未跟踪七项测试，isProcessForeground 包内覆盖缝隙、延迟补记方法、Gradle 排除和宿主脚本调用均已存在；不能把已编译 class 或历史 XML 当作上轮通过。未修改配置、构建文件、JNI、共享核心或发布库；未提交、未发布。

| 文件 | 输入 → 输出 / 职责边界 |
| --- | --- |
| android/src/test/java/cn/reactnative/modules/update/FirstLoadTest.java | 反射分配真实 UpdateContext，覆盖进程前台探测，代理 SharedPreferences/生命周期；真实文件和 JNI 状态核心驱动十项断言，不复制首启决策。新增三项为连续无 UI 重启、成功状态到达后零写、前台解析早于 Activity 时零重复提交；其余七项遗留测试保留，并补全非 started 生命周期零写检查。 |
| android/src/main/java/cn/reactnative/modules/update/UpdateContext.java | onActivityStarted 注销一次监听后调用既有 startDeferredFirstLoad；复用 commitLock 内 firstTime/currentVersion/launchVersion 门禁和状态核心，仅一行生产接线，不添加新测试 API。 |

先负控：在 Example/e2etest/android 运行 `gradlew.bat :rn-update:compileDebugJavaWithJavac :rn-update:testDebugUnitTest --offline --console=plain`。遗留七项时宿主 48 项中两项失败；扩至十项后宿主 51 项仍只有 `activityStartsDeferredLoadOnceAndNextProcessRollsBack`、`consumedJsMarkerDoesNotPreventActivityBookkeeping` 失败，分别命中缺一次提交、firstTime 未清。日志 `TEMP/pakta-firstload-negative.log` 保存扩充后的负控。不是源文本匹配或跳过 JNI 的模拟通过。

补齐回调调用后，同目录运行 `gradlew.bat :rn-update:compileDebugJavaWithJavac :rn-update:testDebugUnitTest :rn-update:lintDebug --offline --console=plain` 成功，日志 `TEMP/pakta-firstload-gradle.log`：

- 前置 testInstallHost 在 Linux JDK17/JUnit4.13.2、`-Xcheck:jni` 下执行 51 项（既有41 + 首启10），0失败；构建物仅宿主 .tmp，不重建 android/lib 四 ABI。
- testDebugUnitTest 本次实际执行，XML 为取消6、keepnames2、HTTP7、回放28、路径3，共46项，0失败/错误/跳过；总数为51文本+46 XML=97项，不能宣称97项均由Gradle XML汇总。
- 首启覆盖无 UI 多次启动不消耗 firstTime、首次 Activity 单次补记后下一进程回滚、JS marker 已消费仍补记、版本替换/firstTime 已清/包内重置后零写、成功后不重开失败窗口、前台先行不重复提交及前台直接首启。
- Android lint XML 为0错误/5警告：DefaultLocale、DiscouragedApi、ObsoleteSdkInt、StaticFieldLeak、UsableSpace各1；既有 abortOnError=false 未改，不以退出0代替读取报告。
- SDK `bun run lint` 成功：Biome58文件、TypeScript及contract/parity19方法通过；Harmony因未发现DevEco/OpenHarmony SDK跳过，非类型检查通过。日志 `TEMP/pakta-firstload-lint.log`。
- 配置/构建文件及JNI直属文件、四ABI库的14份文件前后SHA-256一致，快照 `TEMP/pakta-firstload-protected-before.json`；不覆盖进入前或并行变更。已回查根/SDK/Android及Java/test地图，无顶层结构变动，不为本轮改写全局历史状态。

边界：Application/ActivityManager/SharedPreferences 为替身，生命周期由测试主动触发；真实 JNI 是 Linux 宿主而非 ART，不证明 Android 系统调度、磁盘耐久性、真实后台推送/HeadlessJS、设备崩溃恢复、Release/R8 或其他平台。成功状态测试直接投影已成功快照，不绕过 Debug 短路冒充真实 markSuccess 验证。既有 UpdateContext 超800行，本轮不借机扩展重构；不新增源码注释，文件职责契约登记于本节。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

## SDK-26 宿主独立等待期限（2026-11-14）

保留 checkAndUpdate 名称与旧签名；Android 新增 timeoutMillis 重载、默认 30 分钟、cached daemon 等待池，claim 后在独立守护线程运行唯一轮次。Harmony provider 透传 timeoutMs，编排器默认 30 分钟，NaN/Infinity 归默认、负数归零；Promise.race 的计时器在完成/超时/拒绝均清理。failed/timeout 只是调用方等待结果，不写共享轮次结果、不取消轮次，也不重载当前实例。reset/config 仍可阻止晚到提交；冷启动与崩溃救援保留原预算和单飞身份。

`bun test src/__tests__/nativeHostApi.test.ts src/__tests__/androidHostWait.test.ts`：25 pass / 0 fail、83 断言。前者 18 项在 VM 运行真实 Harmony 入口/执行器，控制计时器与网络/配置核；后者 7 项由 JDK17 编译完整真实 PaktaNativeUpdate/NativeCheckOrchestrator/NativeUpdateResult，真实 Java 线程验证长短调用独立、默认签名、负期限、超时后结果复用、配置/reset 拒绝及中断。Android API、IO/提交和配置核是替身，不代表 JNI/ART、真实系统主线程、设备下载或落盘耐久性；后续全量 lint/SDK/HAR 以根台账新增回执为准。

## Android 启动快照原子性（2026-11-14）

配置写入在 commitLock 内先推进 reset/config 两代际，再持久化新配置；原启动端分三次无锁读取，可采到新代际配旧配置，之后提交时两计数均未再变，旧配置决策仍可能通过。新增 StartSnapshot 与 RoundHost.snapshot，DeviceRound 只委托 UpdateContext.snapshotNativeRound，在原 commitLock 内一次读取配置与两代际；不另加锁、不把网络/摘要放入锁内，实时取消仍读取现有计数。

InstallCommitTest 在真实 setNativeConfig 的 SharedPreferences commit 停点暂停写入，确认此时已为新代际/旧配置，再并发读取真实 DeviceRound 快照，必须等待写入结束且只返回新配置及对应代际；第二项用重配前快照验证晚到提交零写。存储为代理、线程与 UpdateContext/DeviceRound 方法真实执行，安装核心使用 Linux JNI；不证明 ART 调度或设备落盘耐久性。

在 Example/e2etest/android 执行 `gradlew.bat :rn-update:compileDebugJavaWithJavac :rn-update:testDebugUnitTest --offline --console=plain`，退出0，原始日志 `TEMP/pakta-round-snapshot-20261114/gradle.log`。testInstallHost 为 **53 项/0失败**（原51+快照2），普通 JVM XML 为 **46项/0失败/0错误/0跳过**，分组摘要 `jvm-xml.json`；新增两项沿 InstallCommitTest 既有排除只在 Linux JNI 宿主执行，不同时算入46。只编译 Java/宿主 JNI，不重建 android/lib 四ABI、不发布。
