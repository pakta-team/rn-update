# 共享配置 / 轮次核心与三端接线
> L2 | 父级: CLAUDE.md

## 范围与来源

2026-11-13 的 T13/T14 阶段从本机干净上游 D:/code/react-native-update 的冻结 HEAD `b80885832b182330114326e540f3103df408463a` 迁入 native_config、native_round、round_engine 六个文件和四份 JSON。未 fetch、未推进冻结点；当时仅迁纯核，未改平台编排。后续三端接线以下节为准；不换库、不删键、不迁 schema，也不以源码接线代替全端验收。

## 文件契约

当前三端均已接入共享 StepRound：AndroidRound 经 NativeUpdateFlow/native_round_jni 调用 StepRoundJson，DeviceRound 提供真实 IO；HarmonyRound 经 NativePatchCore/round_napi 调用 StepRoundJson；Apple 的 RCTPaktaRoundEngine.inc 直接调用 StepRound。Android.mk、Harmony CMakeLists.txt、rn-update.podspec 均已登记 native_config/native_round/round_engine。平台仍负责时钟、HTTP 取消、下载、锁内双代际及安装快照复核，不能把纯核 cancel 当作已执行 IO 的回滚。分端事实见 [Android](android-round-map.md)、[Harmony](harmony-round-map.md)、[Apple](apple-round-map.md)。

三端配置归一化同样已委托共享核：Android NativeUpdateConfig → NativeUpdateFlow.normalizeConfiguration → JNI；Harmony NativeUpdateConfig → NativePatchCore.normalizeConfiguration → NAPI（ArkTS 先拒绝非对象及 channel）；Apple RCTPaktaNativeConfig.mm 完成 Foundation JSON 边界转换后直接调用。三者均传 fixedHost=true，由共享 NormalizeConfiguration 拥有白名单、URL 校验、默认服务与去重，拒绝 config.channel；Apple 另以 NSJSONWritingSortedKeys 输出快照并映射 NSError。配置落盘/代际仍归各平台，不是三份独立归一化算法。

| 文件 | INPUT → OUTPUT；职责与依赖方向 |
| --- | --- |
| cpp/update_flow_core/native_config.h/.cpp | JSON 配置 → RunnableConfig、CanonicalNativeConfig、ConfigsEquivalent、NormalizeConfiguration；仅纯值验证，默认 Pakta 服务；通用模式支持 channel，三端宿主 fixedHost=true 拒绝 channel，不落盘 |
| cpp/update_flow_core/native_round.h/.cpp | 配置文本、宿主 env、响应文本和注入样本/时间 → PrepareRound、NextQueryStep、HandleRoundResponse；复用现有全局 updateflow 的请求/响应/策略语义，支持的 diffV 取 pakta::hbc 常量 |
| cpp/update_flow_core/round_engine.h/.cpp | 旧状态和事件 → StepRound/StepRoundJson 的新状态与命令；HostCancellation 比较三份配置和代际，IsSafePathComponent 限制目录组件；不执行命令、不读取时钟、不加锁 |
| cpp/update_flow_core/flow_json.h/.cpp | Value → DeepEquals；忽略对象键序/undefined，数组保序，primitive 严格相等；现有解析限额、顺序和 JNI 行为不变 |
| cpp/update_flow_core/tests/native_flow_test.cpp | 四份冻结向量与本地专项 → 明确期望命令、JSON/Value 等价断言和失败退出码；不替代原 111 个 TS/C++ 向量 |
| cpp/update_flow_core/tests/pakta-flow-vectors.json | 手工显式输入/期望 → 本地身份、取消、预算与安全边界；不是从被测函数反推期望 |
| scripts/test-update-flow-core.sh | C++17 编译器、源和六份向量 → 两个独立真实可执行测试；-Wall -Wextra -Werror，FLOW_BUILD_DIR 可隔离输出，SANITIZE=1 不允许 UBSan 恢复后伪成功 |

新增接口为 `pakta::updateflow`，不重命名旧全局 `updateflow`/`flowjson`，以免改变现有桥和 T11/resume 使用者。上游 native_texts/混淆体系未迁入；本地 service、策略、状态与 rescue key 保留现有明文协议。

## 本地契约与副作用所有权

- 默认 API 为 `https://pakta.yoghourt.space/api`；发现地址为 `https://cdn.jsdelivr.net/gh/pakta-team/rn-update@main/endpoints.json`，与 src/client.ts 相同；自定义 endpoints 不继承公共发现地址。
- 通用配置 channel 参与归一化、等价与原始缓存 config；缺省等价 default，显式 null 不等价，但三端公开 configure 的 fixedHost=true 不接受此键。请求 channel 只从可信宿主 env.channel 获取，不能被配置覆盖；旧宿主缺字段时复用现有 BuildCheckRequestBody 的 default 语义。
- packageVersion 保留本地配置覆盖能力，uuid/rnu/rn/os 保留请求身份；buildTime 作为 opaque 值透传，不转换、比较或推断发行顺序。原始请求（含实际宿主渠道）、配置、响应和到达时间共同构成缓存。
- 根 bundleStatus 原值保留到响应计划和最终 finish，且不污染 hashInfo；unknownBundle 不是 round 的失败状态，不擅自改写更新结论。
- 配置等价包含 appKey、endpoint/queryUrls、channel 及未知配置字段；HostCancellation 先判 config_generation/配置等价，再判 reset。A→B→A 仍由平台单调代际辨别。
- 每个查询的 endpoint POST 和发现 GET 共用 8 次上限；HTTPS-only 配置拒绝明文发现 URL 和注入端点，下载计划去掉明文 URL。核心不能检测实际 HTTP redirect，执行器仍须负责传输层 HTTPS 降级门禁。
- 查询 timeout/callTimeout 和下载 deadline 均受轮次剩余时间截断；diff/pdiff 共用 600000 ms 增量窗口，full 首次到达时独立开启同长窗口。下载成功和激活意图分离，committed.activated 可覆盖意图；commit 命令携带两代际。
- 新增 cancel 事件在 env/http/installed/download/committed 任一等待阶段终止并忽略迟到事件；reason=config_changed 优先表达配置失效，否则 reset。只撤销未来命令，不撤回已执行 IO；平台必须取消在途任务并在提交锁内复核代际，不能把纯核取消误当持久化撤销。

## 向量边界

四份冻结 JSON 保持上游字节不变。回放器仅对请求/嵌套缓存期望插入本地 channel:default，并在配置归一化成功期望中补 channel、替换缺省服务地址；不改事件转移、请求数、下载 deadline 或取消期望。Pakta 专项期望不经过默认渠道适配。测试不导出 JNI/NAPI/Apple 绑定，也不把 JSON 回放冒充平台 IO 测试。

## 历史真实验证（2026-11-13，T13/T14）

环境：WSL Ubuntu，`c++ (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0`。两条完整脚本分别独立编译成功，退出码均为 0：

```sh
FLOW_BUILD_DIR=/tmp/pakta-flow-t13-t14-normal sh scripts/test-update-flow-core.sh
ASAN_OPTIONS=detect_leaks=1:halt_on_error=1 UBSAN_OPTIONS=halt_on_error=1 SANITIZE=1 FLOW_BUILD_DIR=/tmp/pakta-flow-t13-t14-sanitizer sh scripts/test-update-flow-core.sh
```

| 验证组 | 普通 | ASan + UBSan |
| --- | --- | --- |
| 既有 flow_vectors + 解析器健壮性 | 111 向量通过 | 111 向量通过 |
| 配置等价（双向） | 124 断言 | 124 断言 |
| 配置门禁/归一化 | 73 断言 | 73 断言 |
| 原生请求/查询/响应计划 | 55 断言 | 55 断言 |
| 上游轮次/宿主取消/安全路径 | 389 断言 | 389 断言 |
| Pakta 专项 | 47 断言 | 47 断言 |
| 新纯核合计 | 688 断言，0 失败 | 688 断言，0 失败 |

两种二进制另行直接运行 pakta-flow-vectors.json 各 47 断言、0 失败，证明取消/预算专项不是只接入脚本未执行。既有逗号小数 locale 检查因未安装对应 locale 跳过；未运行 libFuzzer、平台原生编译、设备、发包或真实服务器。无存储迁移与平台编排变更。

## 前轮文档核对（2026-11-14）

前轮读取当前三端执行器、配置适配和构建清单，补地图及必需 L3，未运行算法测试或原生构建。以下续轮是新的实跑证据，不追认前轮通过。

## 配置共享化收尾（2026-11-14）

本轮确认上轮绑定已落盘且完整，不再改生产算法、首启、Provider、存储或轮次逻辑。Android JNI 声明/实现/Android.mk/混淆规则/verify 清单、Harmony NAPI 注册/NativePatchCore 声明/CMake/HAR 闸门、Apple 直接调用/Podspec 源清单均覆盖共享 normalize。仅重建发布目录四 ABI 和默认 HAR，并维护配置相关地图；构建临时文件沿用忽略规则，未提交或发布。

### 配置与错误契约

- 三端宿主均传 fixedHost=true，拒绝任何显式 channel（包括 null）；ArkTS 在 JSON.stringify 前额外拒绝自有 channel:undefined，避免序列化丢键。内部通用模式仍允许 channel，不把宿主限制扩散到轮次核。
- 白名单、JS 空白、默认 Pakta 服务、自定义 endpoints 不继承发现、URL 校验与保序去重由 NormalizeConfiguration 唯一拥有；Apple 额外排序 JSON 键，不要求三端字符串字节相同。
- Apple persistConfiguration 和 isJsCheckCompleted 调用 ConfigsEquivalent，默认值/对象键序/尾斜杠和 URL 重复归一后比较；未知字段及身份差异仍不等价，非法 JSON 不等价，数组保序，A→B→A 由代际拒绝旧提交。
- 非法 JSON 配置统一消息前缀为 `Invalid native configuration: `。Android JNI 抛 IllegalArgumentException，NativeUpdateConfig 不吞掉它，configure 通过主线程 callback 返回；native 不可用另为 IllegalStateException。Harmony NAPI 抛 Error，参数个数/类型错误仍是绑定层错误，不冒充配置校验失败。
- Apple 捕获校验异常并返回 nil；error 指针非空时填 NSError(domain=cn.reactnative.pakta, code=1)，userInfo.PaktaErrorCode=INVALID_OPTIONS。非 JSON 兼容 Foundation 值在入核前拒绝。此 NSError 路径本轮为源码核对，未在 Foundation 执行，不声称 Apple 原生错误映射实跑通过。

### 命令与结果

工作目录为 `D:/code/rn-update/rn-update`；Linux 命令通过 `wsl -d Ubuntu -- bash -lc` 执行。以下成功命令退出码均为 0。

```powershell
$env:HARMONY_TYPECHECK_REQUIRED='1'
$env:DEVECO_SDK_HOME='C:\Program Files\Huawei\DevEco Studio\sdk'
bun run lint
bun test src/__tests__/nativeConfiguration.test.ts src/__tests__/harmonyInstallRecord.test.ts
bun run test:contract
bun test src/__tests__
```

- 强制 lint：Biome 58 文件、SDK tsc、真实 DevEco SDK Harmony 类型检查、contract 及四端 19 方法 parity 通过，无 SDK skip。
- 配置与真实 Harmony NAPI 专项 30 pass/0 fail、63 expect；NAPI/共享核/ArkTS VM 累计237 checks，其中包含配置入口错误和 Unicode，不把237全算为新增配置覆盖。
- contract 10/10。SDK 全量首跑444 pass/1 fail，范围外 `dismissErrorAfter clears lastError automatically` 在读取 lastError 时得到 undefined；未改代码，`bun test src/__tests__/provider.render.test.tsx -t 'dismissErrorAfter clears lastError automatically'` 单项复跑通过，随后全量445 pass/0 fail、2637 expect、31文件。保留首跑失败，不宣称修复该计时用例。

```sh
python3 -B -m unittest discover -s scripts/tests/ios-purge-restore -p test_configuration.py -v
FLOW_BUILD_DIR=/tmp/pakta-config-flow-20261114 sh scripts/test-update-flow-core.sh
ASAN_OPTIONS=detect_leaks=1:halt_on_error=1 UBSAN_OPTIONS=halt_on_error=1 SANITIZE=1 FLOW_BUILD_DIR=/tmp/pakta-config-flow-san-20261114 sh scripts/test-update-flow-core.sh
```

- Python配置专项2/2：现提Apple gate/equivalence/cancel表达式链接真实核心，正控通过且3组行为突变均失败；真实Linux JNI以-Xcheck:jni验证Unicode、fixed-host拒绝及IllegalArgumentException前缀，无WARNING。不是ART或Objective-C++构建。
- 普通与ASan/UBSan各111 flow向量/解析健壮性、688断言通过；其中配置等价124、门禁/归一化73。逗号小数locale因环境缺失跳过；未跑fuzz。

```powershell
& "$env:ANDROID_HOME\ndk\28.2.13676358\ndk-build.cmd" -B `
  'NDK_PROJECT_PATH=D:/code/rn-update/rn-update/android' `
  'APP_BUILD_SCRIPT=D:/code/rn-update/rn-update/android/jni/Android.mk' `
  'NDK_APPLICATION_MK=D:/code/rn-update/rn-update/android/jni/Application.mk' `
  'NDK_OUT=D:/code/rn-update/rn-update/.tmp/config-android/obj' `
  'NDK_LIBS_OUT=D:/code/rn-update/rn-update/android/lib' -j8
node scripts/verify-android-so.js
node scripts/build-harmony-har.js
python -B scripts/check-harmony-har.py harmony/pakta.har
python -B harmony/pakta/src/test/verify-round-har.py harmony/pakta.har --llvm-bin 'C:\Program Files\Huawei\DevEco Studio\sdk\default\openharmony\native\llvm\bin'
python -B scripts/test-harmony-har.py
```

NDK r28.2以-B强制四ABI全量重编，发布目录verify检查24个JNI定义、ABI与64位16KiB LOAD对齐通过。默认debug HAR构建成功（29任务，27执行/2最新），版本1.1.0、21份ETS完整清单逐字节匹配、双ABI每个21注册闸门通过；LLVM另核17安装/轮次注册，内部未解析引用均为0。HAR合成正负控3/3。ArkTS/RNOH存在API废弃/权限/设备能力警告，默认product无签名配置，不把HAR库构建当设备验收。

最终闸门曾非零拦截构建后变化的HarmonyRound.ts（HAR source mismatch）。本轮未写该范围外源码，按当前工作区再次执行相同默认HAR构建及两条源码/LLVM校验，29任务23执行/6最新，均退出0；强制SDK lint再次通过。表内以二次构建为准，首版HAR摘要25845a6c2e26608f0a2d5fb151c7ea956834839628695578a2f3a09ff306b07a已失效，不作为最终交付。

| 产物 | SHA-256 |
| --- | --- |
| android/lib/arm64-v8a/librnupdate.so | 44e33715cafe660e83da20b7aa348ba935d3c5aaa37f947843d4ed0d40420a91 |
| android/lib/armeabi-v7a/librnupdate.so | 8466a91d2810af464a05035ae7c23cb8dfadedb9be143edb8ae29c4737567d91 |
| android/lib/x86/librnupdate.so | 0177151d30e258ce45772ed0c44b9babc3e5727de5df2f6d04b6b1a35d3577fc |
| android/lib/x86_64/librnupdate.so | 0302530712a6eb106d4797269d309df96fb5a7837014162d9bd0ae5842832054 |
| harmony/pakta.har | 64a95cdd319be748acf313055cd4d6d61b31ccdb2d81caaab1f0a7e67c3cec53 |
| HAR arm64-v8a/librnupdate.so | 5a583d1b9e6f5ed5e3466e5dea93d3e314d0d4a0166e2b05cb44458bd117e851 |
| HAR x86_64/librnupdate.so | 065674bc73a0d4dcb442fcd1c6d5ba1b3ace08a4346d38489b8199978f125749 |

命令日志位于Windows TEMP：`pakta-config-{lint,tests,apple-jni,flow,android-build,har-build,har-rebuild,sdk,sdk-timer-retry,sdk-retry}-20261114.log`。默认HAR被既有.gitignore忽略，本轮实际覆盖本地文件，不自动force-add。Apple Xcode/Foundation、Android ART配置专项、Harmony设备、Actions及全端同源候选均未验，不扩大完成结论。

## T27 无消费者旧桥清理（2026-11-14）

仅删除 Android/Harmony 的 buildCheckRequestBody、orderEndpointCandidates、isValidCheckResponse、handleCheckResponse 四个内部旧包装。检索生产消费者为零；TS updateFlowCore、C++ update_flow_core 仍分别被 JS 检查/端点及 native_round 消费，均保留。NativePakta、公开宿主API、新配置/StepRound/取消桥、安装/resume、存储和Apple不变。不改候选闭包、CI、package或构建脚本。

文件契约：删除 cpp/update_flow_core/update_flow_jni.cpp；Android.mk 撤掉其编译输入，NativeUpdateFlow 撤掉四声明，verify-android-so 必需清单24降20。Harmony pakta.cpp 撤掉四包装、注册及 update_flow_core.h 直连依赖；NativePatchCore 撤掉四声明。CMake 中 update_flow_core.cpp 仍为新轮次所需，未删除；MakeUtf8String 仍被 resume_napi 使用，保留。新增 verify-android-so.test.js 的文件级职责见 scripts/CLAUDE.md；Harmony verify-round-har 额外拒绝四个旧注册名。

### 本轮实跑

- NDK 28.2.13676358，`ndk-build.cmd -B -j8`，NDK_OUT=.tmp/t27-android/obj，NDK_LIBS_OUT=android/lib，四ABI全量重建成功。默认verify通过架构、20必需JNI和64位16KiB LOAD对齐；22项Node测试通过：实际四ABI各20定义且旧导出消失、隐藏四旧名仍通过、四ABI×五新桥逐项隐藏均失败。测试也在重建前的旧24符号库上验证过旧名不再必需。
- `CI=true node scripts/build-harmony-har.js --build-mode release --skip-install` 成功，29任务24执行/5最新，覆盖默认harmony/pakta.har。输入闸门验证1.1.0/release/DEBUG=false、21份ETS逐字节、双ABI各21必需注册；LLVM额外核17注册、四旧注册缺失及内部未解析引用0。HAR真实正负控5/5、0 skip，含真实制品BuildProfile三字段突变。
- BuildProfile及oh-package从TEMP备份逐字节恢复；BuildProfile SHA-256 `6cded55dc4ab5083f7dd9ac7ecee90830fc2942b6ac43640b0479f4588faadeb`。android-generated暂存目录不存在；HAR仍沿用忽略规则，不force-add。
- `HARMONY_TYPECHECK_REQUIRED=1 DEVECO_SDK_HOME=<DevEco>/sdk bun run lint`：Biome58文件、SDK tsc、真实Harmony SDK检查、contract及四端19方法parity通过，无skip。`bun run test`：contract10、RN077生成器及SDK445/445、2637 expect通过。
- `gradlew.bat :rn-update:compileDebugJavaWithJavac :rn-update:testDebugUnitTest --console=plain --offline --rerun-tasks`：28任务全执行，Linux真实JNI51项与Gradle JVM46项分层通过，0失败/错误/跳过。不是Android ART运行。
- WSL `FLOW_BUILD_DIR=/tmp/pakta-t27-flow sh scripts/test-update-flow-core.sh`：111 flow向量/解析健壮性及688断言通过，locale因环境缺少跳过；本轮未跑sanitizer。

| 产物 | SHA-256 |
| --- | --- |
| Android arm64-v8a | 488638fff2fdd3f38d7a91a40966b0e4810de5d07d6836353b3e338954413313 |
| Android armeabi-v7a | e88ac69d81c981a7afe0e624fc9842a24bcd6a949ae6ac3cdd9c42409d918273 |
| Android x86 | 1b3be30b2e61fc0bb30e63c5e27f73beb5464a01f18fe0a2fde4874827492393 |
| Android x86_64 | 98a07e5de71889c8ff649f7ab348626ae1929a5004bceb9e220b1fd1d9558815 |
| 默认 Release HAR | caa3e8b54cd4a8f14ec3c205697ea2f5e45ea6f434a81459d0fc801dce59900b |
| HAR arm64-v8a | 1beefbbec62e19c72ae8c79dce0f77482fbf7a4eb8304e4d4ff38b7634463cb8 |
| HAR x86_64 | c8cf833766bb2f737d0498154cc07261f7be127b8d97834c2b7e5a26d79f26ee |

日志在Windows TEMP `pakta-t27-{android-build,har-build,lint,gradle,tests,verifier,flow}.log`，版本备份在pakta-t27-har-backup。根L1/SDK及局部地图已回查，无顶层架构变化。既有API废弃、权限/设备能力、无signingConfig及Gradle弃用告警保留；设备、完整RNOH宿主、Actions、Apple原生构建和全端发布候选未验，不提交、不发布。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
