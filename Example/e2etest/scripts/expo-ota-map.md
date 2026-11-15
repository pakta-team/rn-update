# Expo OTA 隔离宿主与设备入口
> L2 补充 | 父级: ./CLAUDE.md

## 输入与职责

此入口验证 Expo57/RN0.86.3 的正常 ExpoReactHostFactory。`create-expo-e2e-project.js` 只创建 fresh 工程，复用主 E2E UI、版本/坏 JS 入口与本地服务，保存 `expo-e2e-project.json` 的候选和源码摘要。安装、prebuild、Gradle 各自显式执行；`assert-expo-e2e-project.js` 在构建前核对完整候选、依赖单源及原生网络边界，`drive-expo-update-ui.py` 在清理测试应用前再次验证候选全部文件。

要求 Node22、npm、Bun、Python3.10+、Android SDK/API36、JDK21；Windows 真差分另需 WSL/Node/C++ 与 Linux node-hdiffpatch。显式选择已启动设备，`adb devices -l` 必须显示 device。工作目录应短且不存在，不复制裁剪过的 node_modules；依赖必须正常完整安装，并保存本轮 package-lock。

## 从干净宿主开始

以下 PowerShell 在仓库根运行。`$Candidate` 与 `$CandidateSha` 必须来自当前 `release:prepare`，不使用文档中历史摘要。

```powershell
$E2e = Join-Path (Get-Location) 'rn-update\Example\e2etest'
$Cli = Join-Path (Get-Location) 'rn-update-cli'
$Candidate = $env:RNU_SDK_TARBALL
$CandidateSha = $env:RNU_SDK_SHA256
if ((Get-FileHash -LiteralPath $Candidate -Algorithm SHA256).Hash.ToLower() -ne $CandidateSha) { throw 'candidate mismatch' }
$ExpoHost = Join-Path $env:TEMP 'pakta-expo-ota-clean'
node (Join-Path $E2e 'scripts\create-expo-e2e-project.js') --source $E2e --project $ExpoHost --sdk-tarball $Candidate --sdk-sha256 $CandidateSha
Set-Location $ExpoHost
npm install --no-audit --no-fund
$env:CI='1'
node node_modules/expo/bin/cli prebuild --platform android --no-install
node (Join-Path $E2e 'scripts\assert-expo-e2e-project.js') --project $ExpoHost --sdk-sha256 $CandidateSha
```

保存 `package-lock.json`、`npm ls --all --json` 和 Node/npm 版本；之后重建该轮用 `npm ci`。不要复制不完整依赖树、删运行文件来缩小宿主，或用安装成功替代 Metro/原生构建。

## 复用 UI 与限定测试网络

生成器复制 `src`、`localUpdateConfig.ts`、v1–v4、brick/fix/rescue-fix 入口，根 `index.js` 使用 Expo `registerRootComponent`，Metro/Babel 使用宿主 Expo 配置。宿主直接开发依赖固定 `@babel/core@7.29.13` 与 `babel-preset-expo@57.0.17`，后者满足 Expo57.0.22 自身的 `~57.0.11` 依赖范围；自定义 `babel.config.js` 从宿主根解析 preset，不能依赖 npm 将 Expo 内部依赖提升。SDK 仅安装工程内 `rn-update-candidate.tgz`，不引用工作树包或 registry SDK。

本地 `plugins/with-e2e-network.js` 在每次 prebuild 中固定 Manifest 与 XML：默认禁明文，仅 `10.0.2.2` 且不含子域例外。它不修改 SDK 或 `expoUsePakta` 的默认网络策略，遇到无关已有 networkSecurityConfig 时拒绝覆盖。标准 MainApplication 保留 ExpoReactHostFactory 与 ApplicationLifecycleDispatcher，不写 nativeConfig/currentHash、不携带 probe.bundle；Expo57 不支持旧架构。

`assert-expo-e2e-project.js` 要求物理安装、全部 tgz 文件字节一致、React/RN/Expo 从应用和 SDK 解析到同一宿主目录；两个 Babel 直接开发依赖必须版本相符且实际入口位于宿主根安装树，只有 Expo 内部嵌套 preset 或只有 package.json 均拒绝。门卫核对生成源码与正常 Expo 原生入口，并保存 `expo-e2e-validation.json`。该证明只覆盖输入与 prebuild，不等于 Babel 转译、Gradle 或设备通过。`npm run test:expo-generator` 为离线正负控，长期 CI 使用同 run 四 ABI/声明打包候选；旧候选的设备结果不绑定新的生产修复。

## 构建与真实制品

```powershell
$env:RNU_METRO_MAX_WORKERS='1'
$env:CMAKE_BUILD_PARALLEL_LEVEL='1'
$env:NODE_OPTIONS='--max-old-space-size=2048'
$env:EXPO_NO_TELEMETRY='1'
Push-Location android
.\gradlew.bat :app:createBundleReleaseJsAndAssets --rerun :app:assembleRelease '-PreactNativeArchitectures=x86_64' --max-workers=1 --no-parallel --no-daemon --console=plain
Pop-Location
Push-Location $E2e
node scripts/compile-node-ts.js
Pop-Location
$env:E2E_PLATFORM='android'
$env:RNU_E2E_BUNDLER='expo'
$env:RNU_CLI_ROOT=$Cli
$env:RNU_E2E_FULL_FALLBACK='true'
$env:RNU_PAKTA_TIMEOUT_MS='900000'
node (Join-Path $E2e '.e2e-artifacts\.ts-build\scripts\prepare-local-update-artifacts.js')
```

准备器的 cwd 必须是 Expo 宿主，`--expo` 实际调用 export:embed；不使用 `--rncli`。首次 fullFallback=true 仅用于 Windows 生成四 PPK，不能直接计为差分通过。v2/v3/v4 必须展示对 v1 的 base-bytecode 等价校验。随后在 WSL 安装并记录 Linux `node-hdiffpatch@2.2.1`，按以下环境调用共享差分器，路径换成本轮绝对 Linux 路径：

```sh
export RNU_WSL_PLATFORM=android
export RNU_WSL_CLI_ROOT=/mnt/d/code/rn-update/rn-update-cli
export RNU_WSL_HDIFF_ROOT=/tmp/pakta-hdiff/node_modules
export RNU_WSL_ARTIFACT_DIR=/mnt/c/Users/Administrator/AppData/Local/Temp/pakta-expo-ota-clean/.e2e-artifacts/android
node /mnt/d/code/rn-update/rn-update/Example/e2etest/scripts/generate-platform-diffs-wsl.cjs
```

该步输入 APK 必须是当前刚构建的 `app-release.apk`；输出 manifest 必须为 fullFallback=false，三个补丁的 ZIP CRC 与 HDIFF 头必须有效。重新构建 APK 后至少重新复制 APK 并生成绑定该 APK 的 pdiff，不混用其他 RN/HBC 的 PPK。

## 真实设备与证据

端口31337与其他 Android/Harmony 套件串行。用 Bun 从 Expo 宿主运行 `scripts/local-e2e-server.ts`；Windows 后台运行须 `Start-Process -WindowStyle Hidden`，保存该次 PID，只停止自己启动的服务。准备完成后运行：

```powershell
python (Join-Path $E2e 'scripts\drive-expo-update-ui.py') --project-root $ExpoHost --evidence-dir (Join-Path $env:TEMP 'pakta-expo-evidence') --sdk-tarball $Candidate --sdk-sha256 $CandidateSha --serial emulator-5554
```

驱动只接受带 probe/e2e 标识的显式测试包名；会安装 Release 并清理该应用数据。`--verify-only` 只执行候选/安装树守门，不访问设备。候选全归档文件匹配后，通过 UI 操作两策略的 full→diff→pdiff→v2-track，逐步断言 label/hash/markSuccess、延后下载不激活、进程重启保持与最终 upToDate。失败保留 XML 和原生日志，不通过改断言或预置 SharedPreferences 取代行为。最终还应从设备拉回 APK 核对 SHA-256，并对包内 SDK SO 与同候选比较；其他 ABI、真正坏 JS 救砖及 Apple 平台另行验收。

## 2026-11-15 本机设备结果

`TEMP/pakta-device-matrix-20261114/expo-durable/expo-runtime-result.json` 为 `passed`，28 个 UI 观察帧覆盖 `silentAndNow`、`silentAndLater` 各自 full→diff→pdiff→v2-track；每阶段确认 label/hash、markSuccess、进程重启保持，延后策略先确认旧版本仍活动及 downloadSuccess，再重启激活，最后均为 upToDate。真实差分 manifest 为 fullFallback=false；这不是通过 nativeConfig/currentHash 或预置更新 bundle 注入选包。

物理安装树全部900份候选文件与 `989603f4562957146935a50724a3beb010ac864c0feede42c0a4cbdc1c855cd1` 一致。该轮 Expo57.0.22/RN0.86.3 Release APK 为 `93272b4f6314b828f11a83304efb4aeabb6375525520ac1b7301cf9add416b14`，从 API36 x86_64 设备拉回的 APK 摘要相同；包内 x86_64 SDK SO 与该候选相同，HBC98、基座 bundle `9e8a18ec081ab57045d2516fe410f1691e2f57f2879107afd1090240ffd4890c`，没有 probe.bundle，见 `expo-network-artifact-identity.json`。错误候选摘要在接触设备前被拒绝，失败记录为 `expo-guard-negative.log`。

最终 Apple 修复候选 `b5ed311d93edb83564357369a10dab59608012351bade92f6125cc6ac55de237` 与上述包逐份比对：各900文件、891文件相同，9处差异仅为7份Apple源码和2份Apple地图；全部 Android、JS、Harmony/HAR 输入逐字节相同，见 `expo-final-candidate-equivalence.json`。设备 APK 仍是以989603构建，以上仅证明未变平台输入等价；不把它写成重建完整b5ed包或Apple设备通过。该驱动尚未覆盖坏JS救砖及其他ABI的执行。

## 2026-11-15 生成器与 runner 分层验证

新的 `TEMP/px1115` 由仓内生成器以旧 `4818abac…` 候选真实创建，正常 `npm install` 安装476包，`npm ls --all --json` 退出0；本机 Expo prebuild 及重复 prebuild 均成功。独立门卫确认全部900份候选文件、19份复制源码、Expo57.0.22/React19.2.3/RN0.86.3单源、标准原生宿主及仅10.0.2.2网络，保存工程证明、安装锁/依赖树、工具版本和原始日志。首个较长目录 `TEMP/pakta-expo-generator-20261115-fresh` 的 npm 连接重置原始日志另存，未裁剪或拼接依赖树。本轮没有执行Gradle或设备，不把生成器输入验证记为后续Expo生产异常处理修复的候选验收。

生成器离线9项正负控通过；真实Jest `--listTests` 确认普通Detox仅三套、独立Harmony native仅一套，连同RN077复制配置等3项回归共5项通过，均零skip。远程发现的误收集通过普通runner显式排除 `e2e/harmony-native/` 修复，独立套件继续保留其variant契约。以上不替代重跑远程设备job。

## 2026-11-15 fresh CI Babel 依赖收尾

隔离快照 `f460` 的 Expo 设备 job `132705153751` 在 `:app:createBundleReleaseJsAndAssets` 实际失败：`Cannot find module 'babel-preset-expo'`，后续 `transformFile` 错误是 transformer 未创建的结果。此前 npm 与 prebuild 通过只证明安装和原生工程生成；它们没有执行自定义 Babel 配置。`TEMP/px1115` 独立重现同一依赖边界：宿主根解析失败，Expo 自身目录可解析嵌套的57.0.17。因此生成器新增上述两个直接编译依赖，构建前门卫和三条持久正负控覆盖缺显式依赖、仅嵌套安装、缺入口和版本漂移；现有回归共12项全部通过、0 skip。

在保留旧 package/安装锁/验证证明后，对既有 `px1115` 正常执行精确版本 npm 安装，新增1包/移除1包，`npm ls --all --json` 退出0。新门卫确认原4818候选全部900文件和框架单源不变，Babel两入口均从宿主根物理解析；宿主真实 Babel 使用 production Android caller 分别成功转译 `index.js`、`src/index.tsx` 与 `e2e/entry.brick.ts`。原始失败解析、前后安装输入和转译证明保存在 `TEMP/pakta-expo-babel-20261115`。此修复验证批次未改SDK生产源或68ab候选，也未启动Metro完整依赖图、Gradle或设备；当时待验的远程设备job已由下一节新快照实际结果更新。

## 2026-11-15 627 fresh Expo 远程真救援通过

隔离公开快照 `627f45867aa673aa8b54d8b770a491a155d535a7` 的 run `43680320293`、job `132709314675` 实际完成 fresh npm安装、prebuild、完整候选/根Babel依赖门卫、Release APK构建及API36/x86_64真坏JS救援。该轮Android-only候选为899文件，TGZ SHA-256 `347bfec0a4118df7d18084f8be83fcfcc432cacf2f57ca17f37f2ace76b19382`；保留的真实APK SHA-256 `141db67d87a830c874c14cad077317887b59e59a2305602d1139293a9b8f42c7`，包内x86_64 SDK SO与该候选一致，基座和两份独立PPK均为HBC98。这是该轮候选的设备证据，不改挂本机68ab或其它ABI。

官方artifact `14148023743`（ZIP SHA-256 `26f37aec5555225f621f7165882cfbab47ae843130d11676a9705ce209e021db`）独立只读核对通过41条原件检查：PID4223/4317均有同包/同PID的AndroidRuntime FATAL与BRICK JavascriptException；fix只在rescue阶段实际GET、响应无forceBoot，随后sealed；PID4736/4895的原生hashInfo读回均为`crashRescue:true`，首次markSuccess接受后，不同进程重启仍显示FIXED/hash且首启标记已消费。产物没有保存`brickflag=disarmed`的独立原生读回；哈希绑定的fix源码写入disarmed及健康重启不代称该项直接采集。证据目录为`TEMP/pakta-platform-validation-20261114/expo-627-real-crash-rescue`，独核JSON为同父目录`expo-627-independent-verification.json`；整体候选关系和其它平台结果见[平台回执](../../../RELEASE_SYNC.md)。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
