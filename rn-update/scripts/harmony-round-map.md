# T15 Harmony 共享轮次与安装集成
> L2 补充 | 父级: CLAUDE.md | 2026-11-13

## 所有权与执行顺序

仅修改 Harmony 生产源、Harmony 宿主测试与测试地图；不修改共享核、Android、Apple、公共 RN Spec、KV/schema 或旧目录布局。开始时工作区已有大量未提交变更，沿用其安装核与平台改动，不归为本轮成果。先读取 install-map 的集成清单，再新增执行器与向量回放；26 条适用向量加覆盖门禁 27/27 通过后才替换真实编排和接 NAPI/CMake。不是通过后补写“先回放”的声明。

## 文件契约

| 文件 | 输入、输出与职责边界 |
| --- | --- |
| harmony/pakta/src/main/ets/HarmonyRound.ts | 端口提供时钟/代际/IO，共享 StepRound 输出命令；执行环境采集、HTTP、安装判定、下载和提交并回传事件；finally 清面包屑，不决定端点或策略。 |
| harmony/pakta/src/main/ets/NativeCheckOrchestrator.ts | 保留调度、JS 已检查去重与宿主单飞入口；配置门禁/HostCancellation 委托共享核，环境 channel 只读 UpdateContext，不接受 config.channel 覆盖；HTTP 按命令超时、25ms 观察代际并 destroy。 |
| harmony/pakta/src/main/ets/NativePatchCore.ts | 收窄 StepRound、配置门禁与宿主取消三个内部接口；十三安装/归档接口与公共 TurboModule 不变。 |
| harmony/pakta/src/main/ets/UpdateContext.ts | downloadNativeRound 构造旧路径任务，沿用 executeTask；提交与公共切包进入下载/清理共用 taskChain，持有队列直到摘要、同步快照、写入和 flush 完成。 |
| harmony/pakta/src/main/ets/DownloadTask.ts | 沿用原下载/patch/Seal/Promote，流式下载25ms调用所有者守卫，取消时 destroy；重试规则、Range/sidecar/目录布局不变。 |
| harmony/pakta/src/main/cpp/round_napi.h | 生产和 Node 宿主包含相同薄绑定；字符串/代际参数校验，C++ 异常转 NAPI Error，不拥有轮次状态或 IO。 |
| harmony/pakta/src/main/cpp/pakta.cpp | 保留九安装导出，补齐 Reserved/CheckSize/Audit/Manifest 四导出与三个内部轮次导出。 |
| harmony/pakta/src/main/cpp/CMakeLists.txt | 增加 archive_limits.cpp、patch_manifest.cpp、native_config.cpp、native_round.cpp、round_engine.cpp；既有 HAR staging 整目录复制已覆盖对应源/头，无需修改构建脚本。 |
| harmony/pakta/src/test/install_napi_host.cpp / test-install-napi.sh | 同一真实生产薄绑定构建 Node addon并链接真实共享核；不冒充 OpenHarmony VM/ABI 运行。 |
| harmony/pakta/src/test/verify-round-har.py | 解读新 HAR 中两 ABI ELF，检查16个安装/轮次注册名称、机器类型、内部未解析符号和包内新执行器；不装载设备 NAPI。 |
| src/__tests__/harmonyRound.test.ts | 真实执行器执行26条适用共享向量，比较事件/IO命令/预算/回执；引擎为轨迹替身，未覆盖的 crashHold/forceActivate/非法事件仅由真实核心桥对拍覆盖。 |
| src/__tests__/harmonyCommit.test.ts | 真实 UpdateContext VM，延迟摘要证明队列隔离、快照拒绝零业务写入、双代际 cache-only 门禁和公共切包失败后队列可恢复；文件快照/存储为替身。 |
| src/__tests__/harmonyInstallRecord.test.ts | 既有55检查扩展到227，真实 NAPI/核对拍所有共享轮次轨迹，按已有核心测试同样注入 default channel 到期望请求/缓存，不改共享向量。 |
| src/__tests__/nativeHostApi.test.ts | 真实入口+执行器，平台 HTTP、下载和引擎替身验证状态/单飞/配置失效，不能替代真实引擎对拍。 |
| src/__tests__/nativeConfiguration.test.ts / resumeDownload.test.ts | 补齐串行队列初始化与真实 timer 注入，保留配置和续传旧断言。 |

新增源码不加注释；既有 L3 未声称全部同步，变更后的文件级契约由本表与局部地图表达。根/SDK地图已回查，无顶级模块或公共架构增删，本轮不改其并行任务状态。

## 取消、快照与兼容边界

每轮开始采样 reset/config 双代际；IO后回到引擎前观察变化，commit 回执不被取消覆盖。下载 watcher 结束后关闭本次守卫，排队/Seal后迟到任务不能 Promote；流式HTTP也检查守卫，原生不可取消的 patch 工作可能完成，但不能晋升。HTTP/下载双预算和 HTTPS过滤由共享轮次决定，HTTP另保留 contract 派生8次尝试防线；Harmony自动重定向仍依赖宿主禁止明文流量，不宣称能观察最终URL。

原生 commit 显式接收两代际并在队列内、摘要后再次复核；同步 installActivationUnchanged 后到 metadata/state/cache 写入没有 await。公共 switchVersion 同样串行并复核 reset（配置写入会同步推进 reset）。grandfathered 仍仅从 current/last 存储身份授予，快照来自真实 verifyActivation，不由请求构造。flush保持旧错误边界，不宣称Preferences具备数据库回滚事务；同步 put 中途异常仍属于旧存储限制。

## 实跑证据

- `bun test src/__tests__/harmonyRound.test.ts`：先回放27/27，1353断言；真实接线后三文件专项38/38。
- `bun run test`：contract 10/10；最终SDK 481/481，2718断言、31文件（补充摘要期间代际变化零写入专项）；真实 NAPI/核/ArkTS VM 227检查。日志 `.tmp/t15-harmony/tests.log`。
- `DEVECO_SDK_HOME=C:/Program Files/Huawei/DevEco Studio/sdk HARMONY_TYPECHECK_REQUIRED=1 bun run lint`：Biome、SDK tsc、强制 Harmony SDK检查、contract/parity均通过，不是skip。日志 `.tmp/t15-harmony/lint.log`。
- `node scripts/build-harmony-har.js --build-mode release --skip-install --out-file .tmp/t15-harmony/pakta.har`：DevEco真实构建成功；首次30任务全执行，后续增量构建也成功。未覆盖仓库默认 harmony/pakta.har，候选只放隔离目录。日志 `.tmp/t15-harmony/har.log`。
- `python harmony/pakta/src/test/verify-round-har.py .tmp/t15-harmony/pakta.har --llvm-bin <DevEco SDK>/default/openharmony/native/llvm/bin`：两 ABI/16注册名/内部未解析引用为0通过；最终候选hash以本页补充结果为准。

最终 HAR SHA-256：`0d5909599f60f29c2d9bc48cad4bacfc323437db7368a59fe87961550fc6207f`。包内 arm64-v8a 库：`306cda07160f98ff37fe733bf5b7dd2df8666ab77e9c9718e611eb4e49de268e`；x86_64 库：`1142473f308f16138a03d5b01115b6d686a3807101930edd768fc03e2e155b40`。完整结果 `.tmp/t15-harmony/link.json`。HAR构建工具重写BuildProfile的副作用已恢复，默认发布HAR未改。

未验：OpenHarmony设备NAPI运行、Hypium、真网HTTPS/重定向、断电/恶意并发改盘、宿主实际重载、RNOH可选C++桥在完整应用内链接。新HAR链接和Node宿主运行不是设备证明；不提交、不发布、不宣称全平台T15/M4完成。

## 默认 HAR 更新（2026-11-13）

本次仅更新默认构建物与本页、harmony/CLAUDE.md；无业务源码、构建脚本或依赖修复，不执行发布、版本提升或提交。以上隔离候选和“默认未改”属于前轮历史，本段记录后续显式授权替换。根 L1、SDK L2 及构建/版本文件契约已检查，无公共架构或接口变化。

- 基线默认 HAR SHA-256：`3a7213e4c1aa66309be3fe916d8b8c10d6207c870114ab6108ce6001e99e1526`；直接执行 check-harmony-har.py 被 `HAR version mismatch` 拒绝。旧制品和两个 Harmony 版本文件备份于 `.tmp/har-refresh-20261113/baseline/`。
- DevEco SDK：`C:/Program Files/Huawei/DevEco Studio/sdk`。先在 har-wrapper 执行 `hvigorw.js clean --no-daemon`（2/2 执行），再执行 `CI=true node scripts/build-harmony-har.js --build-mode release --skip-install --out-file .tmp/har-refresh-20261113/pakta.har`；29 任务中 28 执行、1 up-to-date，CMake/Ninja 与 ArkTS 编译成功。clean 不声明清空原生编译缓存；保留既有依赖，不安装、不修改锁。日志 `clean.log`、`build.log`。
- 对新候选显式执行 `python -B scripts/check-harmony-har.py <候选> --version 1.1.0`：HAR 元数据、当前全部 21 个 ETS/TS 源文件清单及逐字节内容、arm64-v8a/x86_64 ELF64 架构和各 20 个安装/轮次/resume 注册名通过。另用 verify-round-har.py 与真实 SDK LLVM 检查双 ABI，内部未解析引用均为 0；它额外检查 16 个安装/轮次注册名，不与 20 项闸门混计。结果 `candidate-check.json`、`link.json`。
- 候选通过后才复制至 `harmony/pakta.har`，随后对默认路径再运行同一强制闸门通过。默认与候选均为 1,263,606 字节，SHA-256 `ba2938a85c38b25fd4eab175ea803cc0b74a597905577f4b80826bd0114be57a`。包内 BuildProfile 为 `HAR_VERSION=1.1.0`、`BUILD_MODE_NAME=release`、`DEBUG=false`。结果 `default-check.json`、`artifact.json`。
- arm64-v8a 库 SHA-256：`306cda07160f98ff37fe733bf5b7dd2df8666ab77e9c9718e611eb4e49de268e`；x86_64 库 SHA-256：`1142473f308f16138a03d5b01115b6d686a3807101930edd768fc03e2e155b40`。与前轮隔离库相同，不把 HAR 容器摘要变化解释成算法变化或全量原生重编译。
- 版本副作用：SDK、CLI、oh-package 与构建前 BuildProfile 均为 `1.1.0`，没有升降版。Hvigor 重新生成 BuildProfile，移除已有 L3 文件头与末尾换行；已从本次备份逐字节恢复，SHA-256 回到 `aaa7dedd7accb3f8c03bd50de6124b890ad2b59b3a7222177264a5b290e107e5`。两个 package.json、oh-package 字节未变；887 个已记录 Harmony/src、共享核与 android/jni 输入文件摘要均与基线一致，`android-generated` 已清理。证据 `inputs-before.log`、`restoration.log`。
- 恢复并更新默认制品后，以 `DEVECO_SDK_HOME` 和 `HARMONY_TYPECHECK_REQUIRED=1` 再跑 `bun run lint`：Biome 57 文件、SDK tsc、真实 SDK Harmony 类型检查、contract 与四端 19 方法 parity 全部通过，无 skip、无自动修复。`python -B scripts/test-harmony-har.py` 的 3 个测试方法及其负控子例通过。日志 `lint-final.log`、`har-guards.log`。

上述证据均位于 `rn-update/.tmp/har-refresh-20261113/`。构建仍有依赖 API 废弃/权限/设备能力告警、资源名冲突及未配置 signingConfig 告警；不为消除告警修改业务。该结论只覆盖本地 Release HAR 构建、输入/ELF 校验和强制 lint，不覆盖 npm 发布候选、Actions、完整宿主链接或设备验收。

## Release 闸门收尾（2026-11-14）

本轮只改HAR checker/tests、默认HAR构建物和地图；未改平台业务、共享核、构建脚本、版本或依赖。flow-map.md后续配置共享化曾以debug覆盖默认HAR，本段取代该默认产物状态，不抹去历史证据。SDK L2、根L1已回查，无架构增删。

- 基线真实HAR为1.1.0、BUILD_MODE_NAME=debug、DEBUG=true，新checker明确拒绝`HAR BuildProfile BUILD_MODE_NAME mismatch`。它现在同时强制BuildProfile版本等于传入预期版本、模式release、DEBUG字面量false，拒绝缺失/重复/注释伪声明；不借用工作树BuildProfile判断包内配置。
- `CI=true DEVECO_SDK_HOME=<DevEco>/sdk node scripts/build-harmony-har.js --build-mode release --skip-install --out-file <TEMP>/release.har`成功，29任务20执行/9最新。首次构建29任务26执行/3最新已编译成功，但外层临时环境变量未跨调用保留，输出误指向D盘根而复制失败；日志已移回TEMP，立即从备份恢复版本文件，再使用显式绝对TEMP路径重跑成功。不将首次命令记为完整成功，不声称清缓存全量重编。
- 对候选先执行`python -B scripts/check-harmony-har.py <TEMP>/release.har`与`python -B scripts/test-harmony-har.py --har <TEMP>/release.har -v`：5/5、0 skip；包括真实Release正控及仅改包内DEBUG=true、HAR_VERSION错版、BUILD_MODE_NAME=debug的三份真实HAR突变，均命中对应字段拒绝，原HAR摘要不变。另有7组BuildProfile合成负控及既有源码/ABI/注册/路径/重复负控。
- 候选通过真实SDK LLVM的verify-round-har.py后才复制到`harmony/pakta.har`，默认路径再次通过输入闸门：元数据及BuildProfile均1.1.0、release、DEBUG=false，21份ETS/TS完整清单逐字节、arm64-v8a/x86_64 ELF64及各21注册名通过。LLVM另核17安装/轮次注册名，双ABI内部未解析引用均为0，不与21项计数混淆。
- 默认HAR与候选SHA-256：`133e9d56c6e29040df232b0a83a0ced885f10e20aa05a6243ba199aa8c4022fc`；arm64-v8a库：`ebc0f016cd93ce8e65ca6dfe6b383b3ad87cf2cc9c220b9520bfb0b75bd08660`；x86_64库：`f29d43a0281d900e8340e7bf213094e312a3b51c44c5cb4e3b0548f214847906`。HAR沿用忽略规则，不force-add。
- 每次构建均恢复BuildProfile与oh-package备份；工作树BuildProfile保留原debug内容及字节，SHA-256为`6cded55dc4ab5083f7dd9ac7ecee90830fc2942b6ac43640b0479f4588faadeb`，不把源文件恢复成debug误认为包内Release回退。已记录Harmony/src、cpp、android/jni输入摘要无变化，android-generated暂存目录不存在。

全部日志/备份位于Windows TEMP `pakta-har-release-20261114-115502/`：`baseline-rejected.log`、`build.log`、`build-retry.log`、`guards-real.log`、`candidate-check.json`、`default-check.json`、`llvm.json`、`restoration.log`及`inputs-before.xml`。构建保留API废弃、权限/设备能力和无signingConfig告警，不为消警改业务；未验Harmony设备、完整RNOH宿主、Actions或npm发布候选，不提交、不发布。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

## 2026-11-15 真实设备激活快照重入修复

首轮完整设备suite以b5ed候选/ee0d HAR执行9项，4 pass/5 fail/0 skip；基座和三项smoke通过，full下载后主线程`THREAD_BLOCK_6S`，其后diff/persistence失败。完整失败输入及日志由根平台回执独立封存，不以宿主或新HAR覆盖旧结果。

故障`librnupdate.so` Build ID为`991b32ae95c5f0a565a6cf1bc15a222230a3e6be`。同Build ID的构建库反汇编表明，设备栈`0x16393`落在`installActivationUnchanged`的`mutex::lock`调用处；完成回调`0x1c4a3`先调用`napi_resolve_deferred`，`0x1c4af`才解同一锁。Ark同步执行Promise后续逻辑，再进入激活校验形成主线程自锁。

`install_napi.h`只调整注册表临界区：插入快照后先解锁再兑现Promise；同步校验在锁内验证注册表、环境归属和真实文件快照，所有抛错及undefined分配移到锁外；finalizer擦除登记后解锁再析构。不使用递归锁，不改变共享安装算法、状态队列、磁盘协议或公开接口。

- 宿主装载器包含真实生产头，在Promise兑现、undefined分配和抛错三个NAPI边界同步调用JS，再进入真实快照校验；重入钩子只属于测试，不进入HAR或npm包。旧生产头新增用例红测：Node内层30秒期限退出124，Bun 0 pass/1 fail；修复后同套件241 checks、1 pass/0 fail，既有篡改、历史marker和错误码断言保留。这是Node NAPI同步重入注入，不代称Ark设备回归。
- `node scripts/build-harmony-har.js --build-mode release --skip-install`实际DevEco构建成功，29任务/24执行/5复用，Ninja重新编译双ABI。默认HAR SHA-256：`92bb0c023ca9a4c2160a7ed20db8ea19bf7437b7eac8f2e64733f592935bc9ff`；arm64-v8a SO：`5bdce4754c883e48c123d5bb908492358361c70d9a1837f9179d779622bd840c`；x86_64 SO：`4894e00768ee2e761d45df6d675b35c38078cf17026b7edd64605ed684c2dc7f`。
- 直接HAR闸门验证1.1.0/release/DEBUG=false、21份ETS逐字节、双ABI各21注册及4库禁串；真实HAR5项、禁串4项均通过，0 skip；LLVM另核双ABI17安装配置轮次注册、内部未解析引用0。源BuildProfile/oh-package构建后与构建前摘要一致，暂存android-generated目录已清理。
- 原失败及修复证据位于`TEMP/pakta-platform-validation-20261114/harmony-snapshot-deadlock/`；新候选打包、短工程/HAP消费和完整设备重跑由根代理随后独立登记。新HAR通过不使旧b5ed设备结果转绿，不代表完整平台发布准入。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
