# scripts/
> L2 | 父级: ../CLAUDE.md

构建与验证入口。脚本只能组合已有编译、测试和发布规则，不在脚本中另建一套产品逻辑；跨语言协议通过生成向量和独立 C++ 测试自证。

## 成员清单

CLAUDE.md: 构建验证脚本的职责、成员与约束地图
build-android-so.sh: 初始化原生子模块并为四个 Android ABI 编译共享库
build-harmony-har.js: 驱动 Harmony HAR 构建并整理发布产物，并从 package.json 同步 HAR/BuildProfile 版本
build-types.js: 清理 dist/types 后通过独立 tsconfig.build.json 仅编译声明，失败清除半成品，供 prepack 与 packlist 复用
check-binary-strings.js: SDK-08/09 最小异源身份门禁，扫描至少4字节ASCII可打印串并忽略大小写拒绝pushy/react-native-update；导出文件/Buffer扫描，CLI接受逐文件参数，缺失/空/非普通文件失败
check-binary-strings.test.js: Node正负控验证合法Pakta/JNI/协议、多文件数组、空格路径、缺失/空/目录、真实四ABI及逐ABI禁串注入；仅在系统TEMP修改副本
check-harmony-types.js: 对 Harmony 声明与 ArkTS 边界执行静态校验
check-native-spec-parity.js: T09 只读命令入口，委托 native-binding-parity 校验四端签名、生成物、Promise 模式与桥委托，不自动修复
check-packlist.js: 无候选时重建声明并 dry-run；传入 tgz/--sha256 则只读检查候选身份、白名单、安装/轮次/resume 必备源码、Apple片段与四ABI，--release 提取候选内 HAR 再校验
package-source-closure.js: 从 checkout 的 Android.mk、Harmony CMake、Podspec 与 Apple 片段派生本地引用闭包；候选逐字节绑定闭包及包内原生源码到 checkout，拒绝缺源、内容漂移、额外异源源码、开发目录与缓存，不运行平台算法
package-source-closure.test.js: npm dry-run/同源候选正控、闭包逐文件删除、候选三类构建清单及 include 篡改、候选缺头和额外异源源码负控；不替代三端编译
check-package-types.js: test:pack 真实 pack（含 prepack）或接收 tgz/--sha256；先拒绝身份/摘要不匹配，再在临时宿主验证公开API、错误输入与声明闭包，消费后复核摘要，不借用SDK源码
package-candidate.js: 共享候选身份/摘要/规范路径/重复文件校验，拒绝软硬链接等特殊条目；按已验证成员读取原始字节而不解压，不打包、不发布
package-candidate.test.js: 临时tgz正控及错名/错版本/错摘要双入口失败负控；静态约束两分支发布路径和原权限
prepare-release.js: release:prepare 先验版本/Android库，含prepack真实pack一次；同一tgz进入清单和消费检查，复核摘要后输出GITHUB_OUTPUT，绝不发布
check-harmony-har.py: Python3.8+ HAR输入闸门，校验版本/release/DEBUG=false、全部ETS字节、双ABI ELF及21注册；已验证package/前缀用切片移除，兼容Harmony CI容器3.8；全部.so副本由Node参数数组执行禁串门禁，缺Node或超时失败，不替代LLVM链接或设备验证
test-binary-strings-har.py: 必须显式--har的新增专项，验证全部库参数数组/空格路径、额外库禁串/空文件、缺Node拒绝，以及真实HAR四库逐一两种禁串注入和双ABI缺库；不修改既有HAR测试
test-harmony-har.py: 合成HAR正负控覆盖版本/BuildProfile/源码/ABI/注册/条目边界；--har显式读取真实Release正控并仅突变BuildProfile三个字段验证拒绝，未传入则明确skip真实产物测试，不把合成ELF记为链接证据
check-release-version.js: 校验发布 tag 与 SDK/CLI package.json、oh-package.json5、BuildProfile.ets 版本一致
contract.json: T08 本地常量事实入口，覆盖错误码、归档上限、状态/归档/任务编号、wire 版本、安装记录、端点预算、ABI 与仅记录现状的生命周期
contract-schema.js: 校验事实完整性、有限整数、唯一性与编号关联，在目标 IO 前拒绝非法输入
contract-targets.js: 声明跨语言常量分区的文件/事实所有权、唯一匹配模式与等值渲染，不拥有业务执行路径
contract.test.js: Node 独立回归，覆盖逐分区负控、损坏修复、唯一所有权、只读/幂等、分区外字节与生命周期隔离
contract-map.md: T08 所有权、地图增量与原始验收证据，保留未重建原生产物和未做设备验收的边界
resume-map.md: T13 续传半部的纯核心/三端 IO 所有权、文件契约与真实运行证据；记录 Android 双 map 修复、39 项 Gradle JVM 回归、四 ABI 发布库同步/hash/verify 及设备待验边界
flow-map.md: T13 配置/T14 sans-IO 纯核的冻结来源、本地身份差异、文件契约、普通/sanitizer 与取消预算实跑记录；不授权平台接线或存储迁移
android-round-map.md: T15 Android 命令执行器/设备端口/flow JNI 的所有权、28 回放与6取消专项、73项Gradle结果及四ABI重建/hash；设备/JNI运行仍待验
apple-round-map.md: T16 Apple 单编译单元职责片段、唯一共享轮次、逐批摘要/受限提取回放及 macOS/RN/Expo/tvOS 待验边界
harmony-round-map.md: T15 Harmony先回放后接线、安装NAPI/CMake集成、串行队列内快照复核及强制SDK/新HAR双ABI链接证据，设备仍待验
install-map.md: T11 安装记录/封存晋升/激活、manifest/archive核心与后续Android/Harmony桥接回执；分开记录宿主/ABI产物通过和设备待验
generate-contract.js: T08 生成/只读检查入口，全部预检后仅写漂移声明并保留分区外字节及原换行符；导出 generate/planGeneration 供临时副本测试
generate-native-bindings.js: T09 从本地 NativePakta.ts AST 派生旧桥 NativePaktaSpec.java 与 Harmony PaktaMethods.inc；--check 只读，不生成业务或静态 JNI
native-binding-parity.js: T09 四端校验内核，复用 AST 契约检查参数/返回/异步、Android 委托及 Harmony 方法表双展开
release-version.js: 以 rn-update-cli/package.json（patch-worker 的 Docker 输入）为默认来源，统一同步 SDK、CLI 与 Harmony 发布版本；支持 --check
generate-flow-vectors.ts: 从 TypeScript 决策核心生成 C++ 共用的更新流测试向量
prepublish.ts: npm 发布前解析 tag，并调用 release-version.js 同步 SDK/CLI/Harmony 版本后串联文件和原生产物检查
test-ios-purge-restore.sh: 先跑提取器 unittest及真实Status工厂链接回归，再在macOS链接共享状态/安装/摘要/JSON核及现提Status定义，运行tvOS清理恢复顺序；SANITIZE/VERIFY_REGRESSIONS控制消毒与负控
test-tvos-podspec.rb: 只读加载真实Podspec，CocoaPods 1.16.2 Spec/consumer验证14宿主×新旧架构、独立平台/Network/PaktaPrivacy隐私声明/Expo依赖；子进程运行三个内存突变并核对命名失败集合，夹具仅写系统TEMP
test-patch-core.sh: 独立编译并运行补丁核心与 HBC 变换测试，再执行 T11 真实安装核心回归
test-install-core.sh: 以本地 patch::Status/PatchManifest、digest、flow_json 与真实文件 IO 编译安装核心和向量；SANITIZE=1 启用 ASan/UBSan，BUILD_DIR 可隔离编译物
test-android-install.sh: Linux C++17/JDK17 编译生产独立安装 JNI、共享安装/状态/manifest/archive 核并以 -Xcheck:jni 运行 Gradle 类及依赖；BUILD_ONLY 仅构建，TEST_CLASSPATH 由显式 Gradle WSL 任务提供
test-resume-core.sh: 独立编译真实 resume_plan 与本地 flow_json，运行本地用例及可选上游 JSON 向量；SANITIZE=1 启用 ASan/UBSan，--rpc 供控制流测试调用
test-update-flow-core.sh: 分别编译旧 flow 决策和新增配置/轮次回放，-Werror 守门；SANITIZE=1 启用不可恢复 ASan/UBSan，FLOW_BUILD_DIR 隔离普通和消毒制品
verify-android-so.js: Node 侧检查四 ABI `.so` 的架构、16 KiB 对齐及20个 JNI 符号，同一读取Buffer交给check-binary-strings拒绝异源身份；T27 从24项移除四个无生产消费者的旧flow入口，保留共享轮次/配置/安装/resume；可选首参指定库目录
verify-android-so.test.js: 真实四ABI产物的20定义/旧导出消失断言、旧桥缺失仍通过与逐ABI逐新桥缺符号必失败负控；内存变异不写发布库，显式node --test执行
verify-android-so.sh: Shell 入口，协调 Android 共享库验证
tests/: 测试宿主与夹具分组目录，当前仅含 ios-purge-restore/（成员地图见其目录内 CLAUDE.md）

T08 的 118 个声明分区覆盖 23 个文件，每分区必须唯一命中；生命周期事实不进入 targets，T12 已在旧布局统一选择性清理并保护安装级数据，具体删除集合与退化边界见 contract-map.md。T09 独立以 NativePakta.ts 为桥方法事实入口，保留 markSuccess(expectedHash) 与旧桥 Integer count；两个生成链都不成为生产依赖，也不表示原生构建或发布验收完成。ABI 清单及 ELF/对齐声明由 T08 派生，JNI 符号校验仍由 verify-android-so.js 独立维护。

package 命令边界：generate:contract 顺序运行 generate-contract.js 与 generate-native-bindings.js；check:contract 运行前者 --check 与 check-native-spec-parity.js，只读、不自动修复；test:contract 使用 node --test scripts/contract.test.js。lint 末尾接 check:contract，test 先执行 test:contract 再跑 SDK 测试。候选清单与消费入口均接受 tgz/--sha256，不重建候选；无候选时前者重建声明再dry-run、后者真实pack。release:prepare 不调用发布；CI 两分支只能发布其输出路径，发布前sha256sum复核。保留原OIDC/contents权限、provenance/public/beta选项。复用旧HAR分支显式使用前版HAR版本，但仍要求源码和入口匹配当前输入，不能用旧二进制存在性冒充通过。test:release-guards 执行Node候选与Python HAR正负控；CI显式使用python3 -B。

## 2026-11-13 发布闸门复核

本轮只写scripts/CI/package及对应地图；安装、Android安装宿主、resume编译脚本与Apple拆分/轮次回放补必要L3，flow编译入口L3对齐真实配置/轮次输入，算法及命令体未改。三端生产源、共享核、Podspec、默认HAR/SO均不写入，L1已读，无全局架构变动。

- Node候选5/5；HAR 3个unittest方法（含6组失败子例及重复条目负控）通过；错名、错版本、错摘要在清单与消费入口均非零退出。
- 隔离真实HAR `.tmp/t15-harmony/pakta.har` 输入校验通过，SHA-256 `0d5909599f60f29c2d9bc48cad4bacfc323437db7368a59fe87961550fc6207f`；本轮未重建HAR、不追加LLVM/设备通过结论。
- 声明构建后，显式`npm pack --ignore-scripts`生成仅验证用候选：`TEMP/pakta-guard-validation-c39b794d29e4436db061d812742ff10c/rn-update-1.1.0.tgz`，SHA-256 `7ade3dc1f5ccfda6846d2313be7aa431e2d339f7c46aefa62d1c3d5120d13569`；同一tgz清单980文件及独立宿主15声明消费通过。它跳过prepack且未做--release，不是发布候选通过证明。
- 首次真实prepack失败于既有Apple测试格式；并行文件更新后复跑`bun run test:pack`成功（不由本轮修复），含原prepack/lint/声明编译，独立宿主15声明消费通过；该tgz `TEMP/pakta-types-71Gn1x/rn-update-1.1.0.tgz` SHA-256 `f6dadc317eaf66109e62c8a180504fb04cd7912200b8745086e7733c94fba780`，同路径/摘要清单980文件通过。
- 对该真实tgz追加`--release`非零失败，包内默认HAR版本不匹配；直接HAR闸门同样报`HAR version mismatch`。隔离新HAR通过不授权替换默认HAR，不宣称完整发布准备通过。
- Apple首次14项中1项restore摘要漂移；并行预检任务更新后复跑14/14，含安装131检查、34真实循环轨迹及各自负控；这些是现有测试复验，不归本轮实现。未改生产源/摘要基线，不等同于Apple工具链或设备验收。
- WSL四个shell脚本语法、JS语法/Python AST、两份Workflow YAML解析及范围内diff空白检查通过；本轮Python均使用`-B`，未产生新pycache，进入任务前已有缓存不删除。

以上为本地验证，Actions未执行，不提交、不发布、不扩大发布授权。

## 2026-11-14 持续门禁与源码闭包

test.yml 的所有 job 均递归检出子模块；独立 Linux job 以 `python3 -B -m unittest discover -s scripts/tests/ios-purge-restore -p 'test_*.py' -v` 执行当前及新增 Apple Python 测试，避免 GNU 链接参数进入 macOS。macOS Foundation 顺序/消毒/负控 job 保留，test-ios-purge-restore.sh 的全部 Python 调用补 `-B`。package 的 test:apple-source 提供同命令，test:release-guards 追加源码闭包测试。

package files 排除 HDiffPatch 的 builds、HDiff、libParallel 与 dir_diff 开发目录；保留 HPatch、file_for_patch、decompress_plugin_demo.h、dir_patch_types.h、LZMA 和许可证。闭包守卫是保守的本地引用存在性检查：不求值预处理条件，不将外部框架/系统头视为包内输入，不等于平台编译；候选与 dry-run 共用同一守卫。

- 本地 Node 候选5项、源码闭包3项通过；闭包88文件逐项删源均命中指定 missing，7类开发工程/缓存注入均命中指定 forbidden。
- 声明重建及 check-packlist 通过，dry-run 901文件；HAR合成正负控3项通过。本轮未执行真实prepack、release或发布候选验收。
- Windows Python 首跑因 WSL 路径输出编码/子进程错误失败；改为 CI 同构的 WSL/Linux 后全目录16/16，含安装131检查/3删源、guard10检查/2归零突变、14预检场景/4突变、34轮次回放及标记负控。不是 Windows 宿主或 Apple 工具链通过。
- 只改 CI/package/scripts/地图，不改三端生产算法、Podspec或原生产物；Python 使用-B，保留进入前已有及已跟踪缓存。L1已检查，无顶层架构变动；Actions与Foundation本轮未运行。

## 2026-11-14 BuildProfile 发布闸门

checker 新增包内 BuildProfile 的 HAR_VERSION、BUILD_MODE_NAME、DEBUG 唯一声明检查，分别要求预期版本、release、字面量false；缺失、重复或仅在注释中的声明失败。输出附版本、模式、debug、源码数量及每ABI注册数。文件级职责增量由本段表达，未新增代码注释。真实HAR负控必须显式执行 `python -B scripts/test-harmony-har.py --har harmony/pakta.har -v`，本轮5/5、0 skip；默认HAR重建、摘要、恢复及LLVM证据见 harmony-round-map.md 的Release闸门收尾段。未改构建脚本默认debug选择或平台业务，也未跑全量SDK测试/发布。

## 2026-11-14 根 CI 真实 Android/HAR 接线

仅变更根 test.yml、publish.yml、SDK package.json 及对应地图，不改原生、verifier 或闭包实现。test.yml 新增 Android job 配置 JDK17、SDK36、NDK27.1 和宿主 C++ 编译器，安装 e2etest 依赖后执行 `bash gradlew :rn-update:testDebugUnitTest --rerun-tasks --no-daemon --console=plain`；沿用现有 Gradle 依赖触发 testInstallHost，不单独伪造类路径或用纯 JVM 结果代替真实 JNI。

HAR job 使用现有发布 Harmony 容器和递归子模块，从当前源码执行 `npm run build:harmony-har -- --build-mode release`，再以 `python3 -B scripts/check-harmony-har.py harmony/pakta.har` 和 `python3 -B scripts/test-harmony-har.py --har harmony/pakta.har -v` 验证。成功才上传 release-har，缺文件 error；package-check 显式 needs 构建 job，下载到 harmony 后再跑同一真实闸门。publish_with_harmony 在重建/校验后、候选打包前追加相同 --har 正负控；旧 HAR 复用分支保持前版版本语义，不将当前版本测试硬套旧版本。

`bun run test:release-guards` 现显式传入 `--har harmony/pakta.har -v`；本地和无产物 CI 均须先构建 Release HAR 或取得当前源码同版本 artifact，缺失或漂移直接失败，不再以真实测试 skip 放行。

- 本地实际执行 `gradlew.bat :rn-update:testDebugUnitTest --rerun-tasks --no-daemon --console=plain --offline`，28任务全部执行；testInstallHost 文本51项真实JNI/IO测试通过，Gradle XML 46项、0失败/错误/跳过，共97项。Windows通过现有WSL端口执行宿主Linux JNI，不冒称Actions Linux runner或ART设备验证。
- 首跑package门禁真实拦截旧HAR：`HAR source mismatch: src/main/ets/NativePatchCore.ts`，没有skip。随后实际release构建成功，HAR SHA-256 `97ae0d6fcfb0e3c6a427df051ef5b31fa932916be2929f20881f2b220af53d08`；独立checker确认版本1.1.0/release/DEBUG=false、21份ETS及双ABI各21注册，显式--har测试5/5、0 skip。
- 重建后实际 `bun run test:release-guards` 通过，Node17/17、HAR5/5；Node分母包含并行任务当时已增加的候选闭包测试，本轮不修改该实现。验证finally逐字节恢复原HAR、BuildProfile.ets与oh-package.json5，恢复断言True；重建产物不是本次交付内容。
- Workflow YAML解析与构建→上传/下载→真实测试、发布重建→真实负控→候选顺序断言通过；L1已检查，无架构变更。不执行release:prepare、发布、设备或Actions，不把此轮命令验证记为全端验收。

## 2026-11-14 候选源码同源字节守门

候选模式仍用 checkout 派生保守构建/本地引用闭包，但不再只比文件名：checkNativePacklist(files, candidate) 要求候选内全部闭包成员，以及 android/jni、cpp、ios、Harmony C++ 下的 C/C++/Objective-C/头文件/片段/mk/CMake 输入逐字节等于当前 checkout；候选额外异源源码同样失败。三类入口 Android.mk/CMakeLists.txt/Podspec 和递归 include 的候选单独篡改不能借 checkout 正常内容蒙混通过。非规范路径、控制字符、软硬链接及其他特殊条目在候选读取前拒绝；读取只通过已验证成员的 tar stdout，不解压候选。check-packlist 完成后复核候选摘要。没有执行候选构建脚本，也不求值预处理条件；同源守门不等于平台构建证明。

- Node 回归17/17、0 skip：候选6项与闭包11项，含三类构建清单篡改、C++/Apple include 缺源注入、checkout 有头但候选缺头、额外异源源码、硬链接及既有逐文件删除/开发目录负控。test:release-guards 的真实 HAR 回归5/5、0 skip。
- 首次含 prepack 的真实包 `TEMP/pakta-types-EcSWxM/rn-update-1.1.0.tgz`，SHA-256 `48161bb1a7782c6bf64ba45227b7bf60237e347707f456333309c20443674a9d`，1201文件；15声明消费通过，但清单正确拒绝包内当前 checkout 已不存在的 android-generated 副本/测试文件及缺四ABI，不追认为发布闸门通过，不放宽规则。
- 重跑当前原样 npm pack（含 prepack/lint/声明构建），候选 `TEMP/pakta-current-HrP1Xb/rn-update-1.1.0.tgz`，SHA-256 `5afa7795b7e9a42501273ce5eab59dd852edb1bbe2aa1949096b900ebf4a2148`，同一摘要通过900文件 check-packlist --release 与15声明独立消费；包内HAR版本1.1.0/release/DEBUG=false、21份源码和双ABI各21注册通过。prepack 的显式 Harmony SDK 类型检查因无SDK跳过，不记为通过。
- 本轮仅编辑 package-candidate、package-source-closure、check-packlist、两份对应Node测试及本地图；文件职责增量在成员清单及本段维护，未新增代码注释。父级L2/L1已检查，无顶层模块/架构变更；平台、CI、package.json及既有并行变更不写入，不提交、不发布。以上仅为本地包内容/消费核验，不代表Actions、全端原生构建或设备验收。

## 2026-11-14 SDK-08/09 最小禁串门禁

参考冻结上游 `b80885832b182330114326e540f3103df408463a:scripts/check-binary-strings.js`（SDK-08 `fff8074`、SDK-09 `a393802`），保留至少4字节ASCII可打印串、末尾无NUL也扫描、大小写不敏感及逐文件检查语义。本地规则刻意只拒绝 `pushy|react-native-update`，不照搬上游 `update|patch|rescue|reload|hotfix`：后者会拒绝现有合法JNI、补丁协议、救援字段及错误文本。Pakta/RCTPakta、librnupdate、cn/reactnative/modules/update、pakta-team/rn-update及本地服务身份不改名；不以宽泛Pakta整串白名单放行同串禁词，不声称完整文本净化或安全保密。

职责/依赖契约：Node脚本只依赖fs，提供findWording(file)/findBufferWording(buffer)及CLI退出码；Android verifier复用已读取字节，不增加外部工具。HAR checker增加Node运行前提，将包内全部.so（含libc++_shared及额外库）按已校验成员读取到系统TEMP，不解压成员路径，再用 `['node', script, ...files]` 调用同一规则；路径中的空格是单个参数，非shell拼接，超时120秒或缺运行时均拒绝。输出binaryStringsChecked明确分母，错误映射回HAR成员名。该历史批次以地图承载契约；本轮同步已按GEB补check-binary-strings.js的L3，不将原批次注释限制扩张到当前。

- `node --test scripts/check-binary-strings.test.js scripts/verify-android-so.test.js`：30/30、0 skip（新增8项+既有22项），包含多文件第二项带空格禁串、拼接路径负控、缺失/空/目录以及真实四ABI副本逐一追加禁串；真实原库读取前后逐字节不变。直接 `node scripts/verify-android-so.js` 四ABI架构/对齐/20符号/禁串均通过。
- `python -B scripts/test-binary-strings-har.py --har harmony/pakta.har -v`：4/4、0 skip；真实四库各两种禁串共8次注入全部拒绝、双ABI各一次缺库拒绝，额外.so空/禁串、参数数组和缺Node拒绝通过；原HAR摘要前后不变。
- `python -B scripts/test-harmony-har.py --har harmony/pakta.har -v`：既有5/5、0 skip；直接checker通过1.1.0/release/DEBUG=false、21份ETS、双ABI各21注册及全部4个.so禁串。HAR SHA-256 `caa3e8b54cd4a8f14ec3c205697ea2f5e45ea6f434a81459d0fc801dce59900b`。

本次只读验证的Android SO SHA-256：

| ABI | SHA-256 |
| --- | --- |
| arm64-v8a | `488638fff2fdd3f38d7a91a40966b0e4810de5d07d6836353b3e338954413313` |
| armeabi-v7a | `e88ac69d81c981a7afe0e624fc9842a24bcd6a949ae6ac3cdd9c42409d918273` |
| x86 | `1b3be30b2e61fc0bb30e63c5e27f73beb5464a01f18fe0a2fde4874827492393` |
| x86_64 | `98a07e5de71889c8ff649f7ab348626ae1929a5004bceb9e220b1fd1d9558815` |

首次实现仅新增3份脚本/测试、修改verify-android-so.js/check-harmony-har.py及本地图，不写原生产物或平台源。随后package的test:release-guards及根test.yml/publish.yml接入专项，命令实跑Node47/47、既有HAR5/5、新禁串HAR4/4，零skip；47包含原候选17和Android30，不重复累计。重建HAR分支打包前运行专项，复用旧HAR分支保留前版version语义并由checker扫描全部库，不硬套当前版本测试。YAML/Bash及发布权限/一次pack约束本地校验通过，Actions未跑。未重建、重新打包、提交或发布；c240仍是历史候选，package变化后不称当前冻结。不覆盖Apple、绝对构建路径清理、全量业务词净化或设备验收；真实HAR仍含本地构建路径，未改CMake/原生源。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md


## 2026-11-14 本轮同步的 SDK-08 平台路径与隐私资源

Harmony CMake 的 Release 分支以 `-fmacro-prefix-map=${CMAKE_CURRENT_SOURCE_DIR}/=` 裁剪 NAPI_MODULE 的 `__FILE__`；Apple 唯一生产编译单元将 RN `_RCTLog` 的源位置替为 `__FILE_NAME__`，包含片段仍共享同一宏边界。Podspec 隐私资源包更名为 `PaktaPrivacy`，不改声明内容、公开模块、磁盘协议或 Native Spec；现有 Ruby 门禁与 L3 同步。

- `node scripts/build-harmony-har.js --build-mode release --skip-install` 实际构建通过；29任务/25执行/4复用，CMake改动触发原生编译，ArkTS有既有告警，无构建失败。默认HAR SHA-256 `ee0d33ebd0a469e889279943d4ad69ba4a3ad0b29e7a00a71839382c3f3146a8`；源BuildProfile/oh-package构建后逐字节恢复。
- `python -B scripts/check-harmony-har.py harmony/pakta.har`：1.1.0/release/DEBUG=false、21份ETS字节、双ABI各21注册、4库禁串通过；既有真实HAR5项及新增禁串4项全部通过，0 skip。
- TEMP/pakta-upstream-sync-20261114/har-path-check.json：4库未发现当前工作区/源码目录前缀，非通用路径净化证明；初始宽泛盘符正则误报随机短字节，收窄后验证真实路径范围。
- `ruby scripts/test-tvos-podspec.rb`（WSL/CocoaPods）：28宿主/架构组合通过，三个命名突变拒绝；`python3 -B -m unittest discover -s scripts/tests/ios-purge-restore -p 'test_*.py' -v`：18项通过，均非Xcode/Foundation原生构建。

完整源码同步结果见 ../../UPSTREAM_SYNC_RESULT.md；旧c240与旧caa3 HAR仅为历史输入，不能绑定本轮源码。当前Apple原生产物、完整HAP/设备与Actions仍待独立验证。

## 2026-11-15 Harmony CI Python3.8 兼容

远程job132508709447已构建真实Release HAR，随后容器Python3.8.10在`str.removeprefix`处失败。checker在条目已验证以package/开头后改等价定长切片，不扩大路径许可或跳过禁串；实际CPython3.8.20 Windows执行现存HAR入口、5项HAR回归及4项禁串回归全部通过、零skip，源码21份/双ABI各21注册/4库保持，证据`TEMP/pakta-platform-validation-20261114/har-python38-verification.json`。不是远程Linux容器复跑或HAR重建；scripts目录不在实际npm发包清单内，本修复不改变b5ed候选字节。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
