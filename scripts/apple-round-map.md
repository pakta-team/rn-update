# T16 Apple：职责提取与共享轮次

> 父级: CLAUDE.md；冻结上游 `b80885832b182330114326e540f3103df408463a`，本地核对 HEAD 一致，未 fetch。

## 所有权

- `RCTPakta.mm` 是唯一生产编译单元；内部 `.inc` 按顺序包含，不是新公开头、Category 或第二份执行器。保留静态状态、原 os_unfair_lock、进程级下载去重与文件队列，不迁存储。
- `RCTPaktaState.inc` 拥有状态读改写、代际、选择性清理与下载登记；`RCTPaktaInternal.inc` 保留私有声明、进程轮次门闩、崩溃救援与 bundle hash 缓存。
- `RCTPaktaLaunch.inc` 和 `RCTPaktaIdentity.inc` 拥有启动选包、回滚、无桥入口和二进制身份；`markSuccess(expectedHash)` 仍在桥门面，channel 仍取 Info.plist，buildTime 仍是 opaque UUID。
- `RCTPaktaInstallRecord.inc`、`RCTPaktaInstaller.inc`、`RCTPaktaInstallerFiles.inc` 分别拥有记录/归档守卫、既有 full/diff/pdiff 安装链、文件操作；安装代码体不变。
- `RCTPaktaOrchestrator.inc` 拥有调度、广播等待、tvOS 恢复窗口与延后救援激活；`RCTPaktaRoundEngine.inc` 唯一调用共享 `pakta::updateflow::StepRound`，仅执行命令与回传事件。旧 runConfiguredRound/runCheckRequest/performAttempts 已删除，不留下备用路径。
- `RCTPaktaNetwork.inc` 保留 HTTPS 降级重定向拦截，HTTP idle/whole-call 上限由共享命令提供；平台将毫秒转为 systemUptime 秒，下载绝对截止时间继续传给现有安装器。
- Podspec 用 preserve_paths 保留 `.inc`，不将其列入 source_files/public_header_files；加入 native_config/native_round/round_engine 源码，无共享核心改动。

## 分批自证

2026-11-13 Windows / WSL g++ / Bun 1.3.14 / Python 3.13：

1. 拆分前 11 个 Python 测试中仅 800 行守门失败：原文件 3149 行；原翻译单元及关键方法摘要通过。
2. State、Launch 分批提取各通过两项展开后字节摘要校验；Installer 与 Orchestrator 完整落地后 11/11。中间提取器遇到已移动的结束锚点，未写生产文件，修正后通过；临时提取脚本已删除。
3. 接线后不再要求旧手写轮次摘要相同；保留 reader/摘要、锁、清理、下载登记、bundleURL/resolveLaunchBundleURL/restorePurgedLaunch/commitRoundWithGeneration 的旧摘要断言。原始 apple-characterization.json 不覆盖更新。
4. `test_round.py` 现取生产 runOnce 的 for 循环，严格逐处替换 Objective-C IO/finish 语法为宿主缝隙，链接真实五个共享核心源码，以 `-std=c++17 -Wall -Wextra -Werror` 编译，逐事件比对完整命令。输入使用既有 round-engine-vectors，按现有核心测试规则给请求 JSON 补本地 default channel，不改核心向量文件。跳过“完成后第二次 start”纯核用例：Apple 进程门闩不允许再开一轮。该测试不是 Foundation 或下载器运行证明。
5. 安装记录/提交门卫与选择性清理 Bun 专项 64/64；其中 Apple 安装 54 项、混合清理 10 项。四端桥 parity 19 方法通过；Ruby Podspec syntax 通过。
6. 最终 Python 12/12，通过真实生产循环的 34 条共享轨迹；关闭 crashHold/forceActivate 的命名负控退出非零且命令比较失败，证明救援标记不透传会被捕获。Biome 两个修改测试文件通过；真实四段 purge-restore 提取成功。
7. `npm pack --dry-run --ignore-scripts --json` 确认 10/10 内部生产片段入包（不等于 prepack/发布候选验收）；主文件 681 行、最大片段 State 404 行。指定本轮源文件 `git diff --check` 通过。既有 L3 与父级/根地图已检查：无公开接口或顶级模块增删，新增片段职责记录在局部地图，不扩写范围外核心或根规划。

## 保留差异与待验

- tvOS 开关窗口仍由原状态锁串行化；窗口关闭后不激活但可写元数据/响应缓存，崩溃救援仍须过摘要门卫。commit 方法体保持不变，配置替换仍同时增加原 reset/config 两个代际，旧宿主 exact-config 比较保持不变。
- 共享轮次新增明确 commit_failed 分类，并接管 HTTPS 镜像过滤、端点/下载预算与失败降级；这些是冻结上游轮次接入，不声称与旧手写编排所有边缘返回值相同。
- 此轮不吸收上游存储迁移、宿主 API 改名、编码文本；tvOS 预算/网络预检续批已落地，独立 deployment target 与 Network 链接由后续 Podspec 集成补齐，分批证据见下节。
- Windows 无 macOS/Xcode/Foundation：普通 RN/Expo Release、use_frameworks、新旧架构、iOS/tvOS 真实编译、五类 purge-restore 顺序及三个原生突变负控、设备切包/救援均未验；不宣称 T16 全量完成或发布可用。
- 全局 `generate-contract.js --check` 在 Harmony endpointBudget 匹配 0 项处失败；本次不修范围外文件。Apple maxHttpAttempts 仍唯一保留原生成锚点，并以 static_assert 对齐共享 kMaxQueryRequests。
- 提取器展开包含后 #line 是展开视图行号，不再保证映射为原始片段行号；方法体仍直接来自生产文件，缺失或歧义 fail-closed。

## tvOS 预检续批（2026-11-13）

- 只读取冻结 `b808858` 的 RCTPushyOrchestrator.mm 与 react-native-update.podspec，未 fetch。生产写入仅 Network/Orchestrator；Launch 真实 bundleURL/resolve 方法摘要仍保留。未写 State、安装片段、共享核心、桥门面或 Podspec；并行安装提交不计本轮实现。
- Network 的 tvOS Release 分支通过 sysctl(KERN_PROC_PID/getpid) 和 gettimeofday 计算内核进程已耗秒数；查询失败/空结果/负值按上游返回 0。网络 monitor 等待最多 0.5 秒，cancel 后在同一串行队列读取状态；仅 unsatisfied 拒绝，invalid（未答）与 satisfiable 仍放行。这是路径提示，不是服务端可达性保证。
- Orchestrator 先检查配置和网络，再以 `12 - PaktaProcessElapsed()` 扣预算，因而包含网络预检耗时；不足 2 秒直接返回 NO，不开窗口、不设置 purge active、不启动/消耗轮次。恰好 2 秒可执行，deadline 与启动等待均使用相同剩余 budget。
- 恢复窗口开关仍在原锁内；不改提交裁决。超时后仍返回 YES 让 Launch 重解析：已在窗口内提交但完成信号晚到的版本仍应启动；真正晚到提交仅存元数据/缓存，不接管当前启动。崩溃救援是既有单独路径，不改其权限。
- 负控先行：新增 test_launch_preflight.py 首跑以 `PaktaProcessElapsed: expected one definition, found 0` 失败；实现后从真实生产提取 elapsed/network/restore 三个函数体及预算常量，受限替换 ObjC 消息/日志/Block，WSL C++17/Wall/Wextra/Werror 编译，14 个独立进程场景通过。四个可编译突变（重置满预算、离线放行、超时不重解析、满额等待）均以行为断言退出 2。系统 API/dispatch/时钟为替身；宿主 Commit 只是预检测试协作者，不能作为真实提交或线程安全证明。
- 全目录 Python 14/14，通过 34 条生产共享循环回放；同次输出的 131 checks 来自并行安装测试，单列、不归入本轮预检覆盖。当前 Bun Apple 提交/混合清理 21/21、208 expect；19 方法桥契约通过。它们不与先前 64/64 历史数字混计。
- 四段 Foundation 提取生成成功；extract.py 补提取最小预算常量，原生五类顺序宿主仅补 elapsed=0/network=YES 的外部 IO 缝隙，原生产恢复方法体不改写。test_apple_split 不再要求 restore 的旧摘要，其行为由新增真实提取覆盖；原始 characterization 不重写。
- Windows 无 Mac：本次没有 Foundation/Network.framework 编译链接、sysctl 真机权限、真实 monitor 回调/取消竞态或锁内并发证明；原生五类顺序与三个原生突变、RN/Expo Release/use_frameworks/新旧架构/iOS/tvOS 构建和设备救援均待验。Python/WSL 通过不关闭完整 T16，不表示可发布。

### 独立 tvOS target 要求与 Podspec 集成

- 不复用 iOS deployment target：优先 `min_supported_versions[:tvos]`，缺失/异常回退 `15.1`；Expo 若有独立 tvOS 平台声明则采用该值，不能把 Expo 的 iOS 值复制给 tvOS。iOS 计算保持独立。
- tvOS target 需要链接 `Network.framework`（冻结上游为 `s.tvos.frameworks = 'Network'`），并检查资源 bundle 的 tvOS 最低版本；生产 Network API 仅在 TARGET_OS_TV && !DEBUG 编入。上述预检续批没有修改 Podspec；以下为独立集成批次，不追认前批已完成链接。

#### Podspec 集成验证（2026-11-13）

- 仓库写入仅 `rn-update.podspec` 与本测试地图；保留进入任务前已有的共享源码/preserve_paths 接线，不写 Apple 生产源、共享核、包配置或其他地图。已读根/SDK/scripts 地图并检查既有 Podspec 契约，无新文件/模块或公开桥 API 变化。
- tvOS 从 `min_supported_versions[:tvos]` 单独取值；helper 缺失、返回 nil、键缺失、值非法或调用抛异常均回退 `15.1`。Expo 从自己的 `s.platforms` hash 内 `:tvos => '版本'` 或 `s.platform = :tvos, '版本'` 声明覆盖，非法声明保留 RN/fallback 值；hash 匹配限制在右花括号内，不能吸入后续无关 hash。iOS helper、`11.0` fallback 及原 Expo iOS 解析/覆盖代码保持不变。
- `s.tvos.frameworks = 'Network'` 仅声明 tvOS 链接；RCTPakta/Expo subspec 继承该配置，iOS consumer 不含 Network。隐私 `PaktaPrivacy` bundle 声明保留（本轮SDK-08同步更名，旧记录使用react-native-update_privacy），规格中 tvOS deployment target 独立；这里只验证 CocoaPods 规格继承，不宣称生成的 Xcode bundle target 已构建。
- 隔离宿主脚本保存在本机临时目录 `C:/Users/Administrator/AppData/Local/Temp/pakta-tvos-podspec-check.rb`，不进入包/CI；WSL Ruby 3.2.3、CocoaPods 1.16.2 执行真实 `Pod::Spec`/consumer。Podfile、Expo 元数据/Podspec 和 RN helper 是夹具，Node 解析结果由宿主替换，不是实际 npm 多宿主安装。新架构旧分支原有 `s.pod_target_xcconfig` getter 在该 DSL 不存在，测试仅补一个读取 attributes_hash 的 getter，不改生产实现，也不把此夹具当作新架构构建证明。
- 先行负控：修改 Podspec 前 28/28 均在 tvOS 版本断言失败（普通 RN 11.0、RN helper 17.0、Expo iOS 18.0 被复制给 tvOS），命令退出 1。实现后修正夹具 consumer API 假设，最终 28/28 通过；一次 WSL shell 变量转义导致的突变命令未传参不计为负控证据，改用 PowerShell 参数循环重跑。
- 矩阵为 14 类宿主各跑 `RCT_NEW_ARCH_ENABLED=0/1`：无 helper；RN 仅 iOS；RN 独立 tvOS=16.4；helper 返回 nil/抛异常；tvOS 值 nil/非法；Expo hash 中 iOS=18.0/tvOS=17.2；Expo 仅 iOS 保留 RN tvOS；Expo 仅 iOS 回退15.1；Expo 单 tvOS 声明；Expo 非法 tvOS；无关后续 hash 的 tvOS 不误采；tvOS 在 iOS 前的倒序 hash。每项校验两端版本、Network 平台隔离、subspec 继承、隐私 bundle 声明与 Expo 条件依赖。
- 实现后三个内存突变各自非零退出 1：`shared-target` 将 tvOS 改回 iOS（28项失败）；`missing-network` 删除链接（28项失败）；`expo-ios-copy` 将 Expo iOS 值写给 tvOS（6项失败，其余22项通过）。没有将突变写回仓库。Ruby `-c`、范围内 diff 空白检查通过。
- 既有 Python 全目录回归 14/14 通过，含131安装检查、14预检场景、34真实循环轨迹及其既有负控；19方法桥契约通过。这是复验，不计为本批新增覆盖，不改摘要基线。
- 未执行 Mac/Xcode/Foundation/Network.framework 编译链接、pod install、真实 RN/Expo Release、use_frameworks、新旧架构原生构建或设备验收；完整 T16 与发布状态仍未关闭。后续 Mac 必须检查应用与隐私 bundle 的 `TVOS_DEPLOYMENT_TARGET` 以及最终 Network 链接，不能仅以规格 consumer 通过替代。

#### 持久测试与 CI 接线（2026-11-14）

- 原 TEMP 脚本迁为 `scripts/test-tvos-podspec.rb`，从脚本位置解析仓库输入，不再绑定本机绝对路径；直接读取现有 Podspec 与包元数据，不复制或修改部署目标算法。14类宿主×新旧架构保持28项，另明确检查预期subspec集合和subspec的iOS版本/Network隔离。
- 普通入口先要求生产基线全通过，再以三个独立Ruby子进程执行内存突变；每个替换锚点必须唯一，负控必须退出1且JSON中的失败宿主/架构/原因集合精确匹配28、28、6项。加载异常、语法失败、缺锚点、错误失败原因或未知参数不能冒充负控成功。
- Podfile、Expo声明与RN helper仍是夹具，Node结果仍由宿主替换；CocoaPods DSL缺少getter时仅在测试进程补读attributes_hash。它验证规格解释和继承，不是实际多宿主npm解析、install_modules_dependencies现代分支或新旧架构编译证明。
- 接入根 `.github/workflows/test.yml` 已有Ubuntu `package-check`：Ruby固定3.2.3，安装CocoaPods 1.16.2后运行同一个脚本；`GEM_HOME`/`TMPDIR` 指向 `runner.temp`，不新增发布入口、不改权限或包配置，既有macOS清理恢复job保持独立。
- 本地WSL Ruby3.2.3/CocoaPods1.16.2：生产28/28，三个突变分别以指定原因捕获28/28、28/28、6/28，子进程均退出1，外层退出0。首次迁移因instance_eval共享局部变量覆盖包JSON失败，已隔离变量并复跑；Windows TEMP挂载不满足Ruby临时目录权限检查，正式复验使用WSL `/tmp`，不把该回退尝试计为通过。
- 最终从仓库外 `/tmp` 执行持久入口仍通过；测试脚本与生产Podspec的Ruby语法通过，Python只读解析Workflow并核对已有job/工作目录、固定工具版本、TEMP环境和原macOS job通过，未知突变/旧式裸参数均退出1且提示用法；范围内 `git diff --check` 通过。未重跑无关构建/pack或覆盖既有并行修改。
- 测试夹具由 `Dir.mktmpdir` 写系统TEMP并在结束清理，突变仅在内存，控制台日志位于 Windows `TEMP/pakta-tvos-podspec-persistent.log`。本批只写scripts测试/地图与CI/地图；已检查SDK/根地图，无全局结构或生产契约变化，不扩写根台账。无Mac，未执行pod install、Xcode/Foundation/Network链接、真实RN/Expo Release/use_frameworks/设备验证；Actions仅接线，不宣称远端通过，T16仍未关闭。

持久入口（从SDK目录执行，自动包含三个突变）：

```powershell
ruby scripts/test-tvos-podspec.rb
```

需安装CocoaPods 1.16.2；Windows可用WSL Ruby执行，`TMPDIR=/tmp`。单个负控诊断使用 `ruby scripts/test-tvos-podspec.rb --mutation shared-target`（预期退出1），不替代普通入口的精确集合校验。

## 复验

```powershell
python -B -m unittest discover -s scripts/tests/ios-purge-restore -p "test_*.py"
bun test src/__tests__/appleInstallRecord.test.ts src/__tests__/versionScopedCleanup.test.ts
node scripts/check-native-spec-parity.js
```

Mac 后续执行 `VERIFY_REGRESSIONS=1 sh scripts/test-ios-purge-restore.sh`，并分别验 RN/Expo Release；不得把 WSL 受限转换回放记成 Apple 原生验收。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
