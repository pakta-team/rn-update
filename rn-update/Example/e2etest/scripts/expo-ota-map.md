# Expo OTA 隔离宿主与设备入口
> L2 补充 | 父级: ./CLAUDE.md

## 输入与职责

此入口验证 Expo57/RN0.86.3 的正常 ExpoReactHostFactory，而不是通过预置 bundle 或 SharedPreferences 注入模拟选包。复用主 E2E UI、版本常量、制品准备器、WSL 差分器与本地服务；`drive-expo-update-ui.py` 在清理测试应用前验证候选 SHA-256、物理安装目录与全部归档文件字节。

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
if (Test-Path -LiteralPath $ExpoHost) { throw 'choose a fresh host directory' }
New-Item -ItemType Directory -Path $ExpoHost | Out-Null
Copy-Item -LiteralPath $Candidate -Destination (Join-Path $ExpoHost 'rn-update-candidate.tgz')
@'
{"name":"pakta-expo-ota-probe","version":"1.0.0","private":true,"main":"index.js","dependencies":{"expo":"57.0.22","react":"19.2.3","react-native":"0.86.3","rn-update":"file:./rn-update-candidate.tgz"}}
'@ | Set-Content -LiteralPath (Join-Path $ExpoHost 'package.json') -Encoding utf8NoBOM
@'
{"expo":{"name":"PaktaExpoProbe","slug":"pakta-expo-probe","version":"1.0.0","android":{"package":"space.yoghourt.pakta.expoprobe"},"plugins":[["rn-update",{"channel":"expo-host-probe"}]]}}
'@ | Set-Content -LiteralPath (Join-Path $ExpoHost 'app.json') -Encoding utf8NoBOM
Set-Location $ExpoHost
npm install
npx expo prebuild --platform android --no-install
```

保存 `package-lock.json`、`npm ls --all --json` 和 Node/npm 版本；之后重建该轮用 `npm ci`。不要复制不完整依赖树、删运行文件来缩小宿主，或用安装成功替代 Metro/原生构建。

## 复用 UI 与限定测试网络

```powershell
New-Item -ItemType Directory -Force -Path e2e,scripts | Out-Null
Copy-Item -LiteralPath (Join-Path $E2e 'src') -Destination src -Recurse
Copy-Item -Path (Join-Path $E2e 'e2e\entry.v*.ts') -Destination e2e
Copy-Item -LiteralPath (Join-Path $E2e 'e2e\localUpdateConfig.ts') -Destination e2e
Copy-Item -LiteralPath (Join-Path $E2e 'scripts\local-e2e-server.ts') -Destination scripts
@'
import { registerRootComponent } from 'expo';
import App from './src';
registerRootComponent(App);
'@ | Set-Content -LiteralPath index.js -Encoding utf8NoBOM
@'
const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
config.maxWorkers = 1;
module.exports = config;
'@ | Set-Content -LiteralPath metro.config.js -Encoding utf8NoBOM
$Manifest = Join-Path $ExpoHost 'android\app\src\main\AndroidManifest.xml'
$ManifestText = Get-Content -LiteralPath $Manifest -Raw
if ($ManifestText.Contains('networkSecurityConfig')) { throw 'inspect existing network policy first' }
$ManifestText.Replace('<application ', '<application android:networkSecurityConfig="@xml/network_security_config" ') | Set-Content -LiteralPath $Manifest -Encoding utf8NoBOM
New-Item -ItemType Directory -Force -Path android\app\src\main\res\xml | Out-Null
@'
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">10.0.2.2</domain>
    <domain includeSubdomains="false">127.0.0.1</domain>
  </domain-config>
</network-security-config>
'@ | Set-Content -LiteralPath android\app\src\main\res\xml\network_security_config.xml -Encoding utf8NoBOM
```

该例外只允许测试宿主访问模拟器/回环地址；不修改 SDK 或生产示例的默认安全策略。重新 prebuild 会覆盖手工测试配置，应在全新宿主中重新应用并检查。标准 MainApplication 保留 ExpoReactHostFactory 与 ApplicationLifecycleDispatcher；不写 nativeConfig/currentHash，不携带 probe.bundle。Expo57 不支持旧架构。

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

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
