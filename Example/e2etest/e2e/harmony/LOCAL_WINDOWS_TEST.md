# HarmonyOS 本机 E2E 测试手册（Windows）

<!--
[INPUT]: 依赖 Windows 上的 DevEco Studio、OpenHarmony SDK、hdc、Harmony 模拟器与 e2etest 工程
[OUTPUT]: 提供本机 HarmonyOS Release HAP 的安装、更新闭环 E2E 与故障定位步骤
[POS]: e2e/harmony 的机器化运行手册；把一次性环境探测收敛成可重复执行的命令，不改变测试逻辑
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
-->

本手册针对当前开发机，目标是下次直接复现 HarmonyOS 热更新闭环，不需要重新摸索 SDK、模拟器和 HDC 路径。

## 1. 已验证环境

| 项目 | 当前值 |
| --- | --- |
| 工作区 | `D:\code\rn-update` |
| DevEco Studio | `C:\Program Files\Huawei\DevEco Studio Release` |
| OpenHarmony SDK | `C:\Program Files\Huawei\DevEco Studio Release\sdk` |
| hdc | `sdk\default\openharmony\toolchains\hdc.exe` |
| 模拟器 | Pura 90，x86_64 |
| HDC 目标 | `127.0.0.1:5555` |
| App bundleName | `com.charmlot.testpakta` |
| Ability | `EntryAbility` |
| 本地更新端口 | `31337` |

测试工程实际位于：

```powershell
D:\code\rn-update\rn-update\Example\e2etest
```

## 2. 每次测试前的 PowerShell 初始化

每次打开新的 PowerShell 都执行这一段。环境变量只影响当前终端窗口。

```powershell
$RepoRoot = 'D:\code\rn-update'
$E2eRoot = Join-Path $RepoRoot 'rn-update\Example\e2etest'
$DevEcoHome = 'C:\Program Files\Huawei\DevEco Studio Release'
$SdkRoot = Join-Path $DevEcoHome 'sdk'
$HdcPath = Join-Path $SdkRoot 'default\openharmony\toolchains\hdc.exe'
$HvigorPath = Join-Path $DevEcoHome 'tools\hvigor\bin\hvigorw.js'
$OhpmPath = Join-Path $DevEcoHome 'tools\ohpm\bin\ohpm.bat'
$HdcTarget = '127.0.0.1:5555'
$BundleName = 'com.charmlot.testpakta'

$env:DEVECO_STUDIO_HOME = $DevEcoHome
$env:DEVECO_SDK_HOME = $SdkRoot
$env:HDC_PATH = $HdcPath
$env:HDC_TARGET = $HdcTarget
$env:RNU_HARMONY_BUNDLE_NAME = $BundleName
$env:E2E_PLATFORM = 'harmony'
$env:RNU_METRO_MAX_WORKERS = '2'
$env:RNU_PAKTA_TIMEOUT_MS = '300000'

Set-Location $E2eRoot
```

确认 SDK 和模拟器目标：

```powershell
Test-Path $HdcPath
Test-Path $HvigorPath
Test-Path $OhpmPath
& $HdcPath version
& $HdcPath list targets
```

`hdc list targets` 必须能看到 `127.0.0.1:5555`。如果 DevEco 中有多个模拟器，只保留 Pura 90 运行，并始终保留上面的 `HDC_TARGET`，避免误连到旧的 `127.0.0.1:5557`。

模拟器优先通过 DevEco Studio 的 `Tools → Device Manager` 启动 Pura 90。不要同时启动多个 Harmony 模拟器；它们会竞争内存和 HDC 连接。

## 3. 最快路径：直接重跑已准备好的闭环

适用于代码、HAP 和 `.e2e-artifacts\harmony` 尚未被清理的情况。测试的 global setup 会自动启动本地更新服务器，**不要另开 `npm run server`**。

```powershell
$env:RNU_E2E_SKIP_PREPARE = 'true'
$env:RNU_E2E_FULL_FALLBACK = 'true'

Test-Path '.e2e-artifacts\harmony\manifest.json'
npm run test:e2e:harmony
```

成功标准：

```text
Test Suites: 2 passed, 2 total
Tests:       9 passed, 9 total
```

覆盖的顺序是：

```text
BINARY_BASE
  -> E2E_FULL_V1
  -> E2E_PPK_PATCH_V2
  -> E2E_V2TRACK_V4
  -> 重启后保持 v4
  -> upToDate 且不切换 bundle
```

如果只想检查设备驱动和首屏，不跑更新链：

```powershell
npx jest --config e2e/harmony.jest.config.js e2e/harmony/smoke.test.ts
```

## 4. 制品不存在时：重新生成本地更新制品

如果上一节的 `manifest.json` 不存在，先生成 Harmony 的 v1/v2/v4 bundle 和本地服务制品：

```powershell
Remove-Item Env:RNU_E2E_SKIP_PREPARE -ErrorAction SilentlyContinue
$env:RNU_E2E_FULL_FALLBACK = 'true'
$env:RNU_HARMONY_SKIP_ASSETS = 'true'

npm run prepare:e2e
Get-Content '.e2e-artifacts\harmony\manifest.json'
```

这一步要求工作区根目录存在 `rn-update-cli`，并且 CLI 已安装/构建。脚本会优先寻找：

```text
D:\code\rn-update\rn-update-cli
```

`manifest.json` 中的 `fullFallback: true` 表示当前 Windows 环境没有可加载的 `node-hdiffpatch` 原生绑定，`.ppk` 阶段使用显式声明的 full 包回退。这能验证下载、安装、重启、持久化和 upToDate 编排，但不能证明真实二进制差分算法已经执行。

需要真实 `.ppk`/v2-track 差分时，按同目录 [README.md](./README.md) 的 WSL 流程生成 patch，然后把 `RNU_E2E_SKIP_PREPARE=true` 重新跑测试；不要把 full fallback 当成真实差分通过证据。

## 5. 基座 HAP 重新构建与安装

只有以下情况才需要重新构建基座 HAP：

- `e2e/entry.base.ts` 或 Harmony App 代码发生变化；
- 当前设备没有安装 `com.charmlot.testpakta`；
- 测试提示 HAP 是旧版本或启动后 RNOH 崩溃。

### 5.1 必须使用 Release HAP

不要用 Debug HAP 验证重启持久化。Debug 模式下 JS 层的 `markSuccess` 会被跳过，可能出现第一次更新看似成功、重启后回滚的假失败。构建参数必须包含：

```text
-p buildMode=release
```

同时，`entry/build-profile.json5` 必须保留两个 ABI：

```json5
abiFilters: ["arm64-v8a", "x86_64"]
```

当前模拟器是 x86_64；缺少 `x86_64` 会导致 `libRNOHApp is undefined`，应用无法启动。

### 5.2 Windows 路径和资源限制

Windows 直接在深层仓库路径运行 RNOH/CMake 可能触发 Ninja `MAX_PATH`。本机已验证的构建约束是：

```powershell
$env:NODE_OPTIONS = '--max-old-space-size=2048'
$env:NINJAFLAGS = '-j1'
$env:CMAKE_BUILD_PARALLEL_LEVEL = '1'
```

如果深路径构建失败，把整个 `harmony_use_pakta\harmony` 工程复制到短路径（例如 `D:\rnu-harmony-build`；目标目录下应直接有 `AppScope`、`entry` 和 `hvigorfile.ts`）再构建；不要修改仓库中的源码路径。构建时使用当前仓库的 `pakta.har`，并先完成制品生成，再生成 base bundle，最后再构建 HAP，因为制品准备会更新 Harmony rawfile bundle。

先在原始 RN 工程中生成 base bundle：

```powershell
$HarmonyAppRoot = Join-Path $RepoRoot 'rn-update\Example\harmony_use_pakta'
$ShortHarmonyRoot = 'D:\rnu-harmony-build'

Set-Location $HarmonyAppRoot
npx react-native bundle-harmony --dev false --entry-file e2e/entry.base.ts

$SourceRawfile = Join-Path $HarmonyAppRoot 'harmony\entry\src\main\resources\rawfile'
$ShortRawfile = Join-Path $ShortHarmonyRoot 'entry\src\main\resources\rawfile'
New-Item -ItemType Directory -Force -Path $ShortRawfile | Out-Null
Copy-Item (Join-Path $SourceRawfile '*') $ShortRawfile -Recurse -Force
Copy-Item (Join-Path $RepoRoot 'rn-update\harmony\pakta.har') `
  (Join-Path $ShortHarmonyRoot 'pakta.har') -Force
```

短路径副本只用于本机构建，不要把它当成源码工作区提交。若复制后 `entry/oh-package.json5` 仍指向仓库深路径的 HAR，临时改为 `pakta: 'file:../pakta.har'`；若 `entry/hvigorfile.ts` 仍引用深路径的 `hvigor-plugin`，把当前工程的 `harmony\hvigor-plugin.ts` 复制到短路径根目录，并将临时引用改为 `../hvigor-plugin`。

Hvigor 构建命令：

```powershell
Set-Location $ShortHarmonyRoot
node $HvigorPath `
  --mode module `
  -p module=entry@default `
  -p product=default `
  -p buildMode=release `
  assembleHap --no-daemon
```

输出应为：

```text
entry\build\default\outputs\default\entry-default-signed.hap
```

如果只有 `entry-default-unsigned.hap`，说明本机签名配置没有生效。应在 DevEco Studio 完成本机自动签名，或按 [signing.local.example.json5](../../../harmony_use_pakta/harmony/signing.local.example.json5) 创建仅存在于本机的 `signing.local.json5`；不要把私钥、证书密码或真实 profile 提交到 Git。

签名证书或 bundleName 发生变化时，先卸载再安装：

```powershell
$HapPath = 'D:\rnu-harmony-build\entry\build\default\outputs\default\entry-default-signed.hap'

& $HdcPath -t $HdcTarget uninstall $BundleName
& $HdcPath -t $HdcTarget install $HapPath
```

`install sign info inconsistent` 通常不是 HAP 内容问题，而是设备上旧包的签名证书与新 HAP 不一致；执行 `uninstall` 后再安装。

## 6. 失败时按现象定位

| 现象 | 处理 |
| --- | --- |
| `No HarmonyOS device/emulator connected` | 启动 Pura 90，确认 `hdc list targets` 有 `127.0.0.1:5555`，并重新设置 `HDC_TARGET`。 |
| `libRNOHApp is undefined` | HAP 没有打包 x86_64；检查 `entry/build-profile.json5` 的 `abiFilters`，用 Release 重新构建并安装。 |
| `install sign info inconsistent` | 卸载旧 bundle，再安装新 HAP；同时确认 bundleName 没有变化。 |
| 重启后 v4 回滚 | 不要使用 Debug HAP；确认本次确实使用 `-p buildMode=release`。 |
| `manifest.json` 不存在 | 取消 `RNU_E2E_SKIP_PREPARE`，执行 `npm run prepare:e2e`。 |
| `node-hdiffpatch has no usable Windows native binding` | 仅本机编排测试显式设置 `RNU_E2E_FULL_FALLBACK=true`；真实差分改走 README 中的 WSL 流程。 |
| Metro/CMake 内存不足或卡住 | 设置 `RNU_METRO_MAX_WORKERS=2`、`NINJAFLAGS=-j1`、`CMAKE_BUILD_PARALLEL_LEVEL=1`，关闭 Android 模拟器后重试。 |
| 端口 `31337` 被占用 | 先让上一次 Jest 正常结束；再检查 `.e2e-artifacts\.server.harmony.pid` 指向的进程，只停止该 PID，不要按名称批量杀进程。 |

## 7. 测试结束后的证据

测试完成后可检查最终制品状态：

```powershell
Get-Content '.e2e-artifacts\harmony\manifest.json'
Get-ChildItem '.e2e-artifacts\harmony' | Select-Object Name, Length
```

通过标准不仅是 Jest 退出码为 0，还应满足：最终页面显示 `E2E_V2TRACK_V4`，当前 hash 为 `e2e-v2track-v4`，重启后仍保持该状态，并且没有 `rolledBackVersion` 或 `lastError`。
