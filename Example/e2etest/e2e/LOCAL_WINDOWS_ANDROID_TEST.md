# Android 本机 E2E 测试手册（Windows）

<!--
[INPUT]: 依赖 Windows Android SDK、Java 17、Gradle、Detox、Android AVD 与 e2etest 工程
[OUTPUT]: 提供 Android Release APK 构建、本地更新制品准备、Detox 更新链、局域网真机真服务验收和故障定位步骤
[POS]: e2e 层的 Android 本机运行手册；统一主更新链、bundleHash、Debug smoke、原生冷启动与真实控制面入口
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
-->

本手册把本次会话已经验证的 Android 路径固化下来，适用于当前 Windows 开发机。目标不是只启动页面，而是重复验证 APK、本地服务、full/ppk/pdiff/v2-track、重启持久化和 bundleHash 的完整链路。

## 1. 已验证环境

| 项目 | 当前值 |
| --- | --- |
| 工作区 | `D:\code\rn-update` |
| 测试工程 | `D:\code\rn-update\rn-update\Example\e2etest` |
| Android SDK | `C:\Users\Administrator\AppData\Local\Android\Sdk` |
| Java | `C:\Program Files\Eclipse Adoptium\jdk-17.0.16.8-hotspot` |
| Android 平台 | `android-36` |
| Build Tools | `36.0.0` |
| NDK | `27.1.12297006` |
| Gradle Wrapper | `9.3.1` |
| AVD 名称 | `Medium_Phone_API_36.0` |
| AVD ABI | `x86_64` |
| App applicationId | `com.awesomeproject` |
| 本地更新端口 | `31337` |
| Android 模拟器访问宿主机 | `10.0.2.2:31337` |

本次会话中 Android Detox 主 Release 路径的结果为：

```text
Test Suites: 2 passed, 2 total
Tests:       3 passed, 3 total
```

这两个 suite 是 `bundle-hash.test.ts` 和 `local-merge.test.ts`。其中更新链 suite 有两个测试，分别覆盖 `silentAndNow` 与 `silentAndLater`；bundle hash suite 验证 APK 内嵌 bundle 的 SHA-256 与原生计算结果一致。

## 2. 每次测试前的 PowerShell 初始化

每次打开新的 PowerShell 都执行这一段。环境变量只影响当前终端窗口。

```powershell
$RepoRoot = 'D:\code\rn-update'
$E2eRoot = Join-Path $RepoRoot 'rn-update\Example\e2etest'
$AndroidSdk = 'C:\Users\Administrator\AppData\Local\Android\Sdk'
$JavaHome = 'C:\Program Files\Eclipse Adoptium\jdk-17.0.16.8-hotspot'
$AdbPath = Join-Path $AndroidSdk 'platform-tools\adb.exe'
$EmulatorPath = Join-Path $AndroidSdk 'emulator\emulator.exe'
$AvdName = 'Medium_Phone_API_36.0'

$env:ANDROID_HOME = $AndroidSdk
$env:ANDROID_SDK_ROOT = $AndroidSdk
$env:JAVA_HOME = $JavaHome
$env:DETOX_AVD_NAME = $AvdName
$env:DETOX_ANDROID_ARCHS = 'x86_64'
$env:E2E_PLATFORM = 'android'
$env:RNU_METRO_MAX_WORKERS = '2'
$env:RNU_PAKTA_TIMEOUT_MS = '300000'
$env:Path = "$JavaHome\bin;$AndroidSdk\platform-tools;$AndroidSdk\emulator;$env:Path"

Set-Location $E2eRoot
```

确认工具和 AVD：

```powershell
Test-Path $AdbPath
Test-Path $EmulatorPath
Test-Path (Join-Path $env:USERPROFILE '.android\avd\Medium_Phone_API_36.0.ini')
java -version
& $AdbPath version
& $AdbPath devices -l
```

设备状态必须是 `device`，不能是 `offline`。如果没有设备，优先从 Android Studio Device Manager 启动 `Medium_Phone_API_36.0`；也可以用 PowerShell 启动：

```powershell
Start-Process -FilePath $EmulatorPath -ArgumentList @(
  '-avd', $AvdName,
  '-no-snapshot',
  '-no-boot-anim'
) -WindowStyle Hidden

& $AdbPath wait-for-device
& $AdbPath devices -l
```

如果同时连接了多个 Android 设备，设置实际在线的 serial：

```powershell
$env:ANDROID_SERIAL = 'emulator-xxxx'
```

不要把 `emulator-xxxx` 写死进仓库；它可能随模拟器重启变化。

## 3. 依赖与本地 SDK 守门检查

首次安装或 `node_modules` 被清理后执行：

```powershell
Set-Location $E2eRoot
bun install --frozen-lockfile
```

如果本机没有 Bun，确保 npm 依赖已经完整安装后，至少执行：

```powershell
npm install
```

每次 Android 构建都会通过 `assert-local-sdk.js` 验证当前工作树的 `rn-update`，手工检查也可以执行：

```powershell
node scripts/assert-local-sdk.js
```

输出必须明确指向：

```text
D:\code\rn-update\rn-update
```

本地制品脚本需要可加载的 CLI 构建产物：

```powershell
$env:RNU_CLI_ROOT = Join-Path $RepoRoot 'rn-update-cli'
Test-Path (Join-Path $env:RNU_CLI_ROOT 'lib\exports.js')
```

如果结果为 `False`，先在 `rn-update-cli` 中完成依赖安装和 `build`，再回到 e2etest。

## 4. 构建 Android Release APK

Release APK 是主更新链和 bundleHash 测试的基座。当前 AVD 是 x86_64，因此显式收窄到 x86_64 可以节省构建时间并避免 ABI 误判：

```powershell
$env:DETOX_ANDROID_ARCHS = 'x86_64'
node scripts/run-detox.js android build --configuration android.emu.release
```

成功后必须存在：

```powershell
Test-Path 'android\app\build\outputs\apk\release\app-release.apk'
```

该命令实际执行 Release APK 和 Detox instrumentation APK 的构建，并再次验证本地 SDK。Android 宿主默认包含四 ABI，但通过 `DETOX_ANDROID_ARCHS=x86_64` 时只构建当前 AVD 需要的 ABI。

如果只验证 Debug 首屏，构建 Debug 包：

```powershell
node scripts/run-detox.js android build --configuration android.emu.debug
```

## 5. 准备本地更新制品

Android 的制品准备必须在 APK 构建之后，因为 `base-to-v3.apk.patch` 需要读取 `app-release.apk`。制品生成顺序是：v1 全量 → v2 ppk → v3 Android package diff → v4 v2-track。

当前 Windows 机器如果没有可加载的 `node-hdiffpatch` 原生绑定，显式使用 full fallback：

```powershell
$env:E2E_PLATFORM = 'android'
$env:RNU_E2E_FULL_FALLBACK = 'true'
Remove-Item Env:RNU_E2E_SKIP_PREPARE -ErrorAction SilentlyContinue

npm run prepare:e2e
Get-Content '.e2e-artifacts\android\manifest.json'
```

应该能看到以下文件：

```text
.e2e-artifacts\android\v1.ppk
.e2e-artifacts\android\v2.ppk
.e2e-artifacts\android\v3.ppk
.e2e-artifacts\android\v4.ppk
.e2e-artifacts\android\v1-to-v2.ppk.patch
.e2e-artifacts\android\base-to-v3.apk.patch
.e2e-artifacts\android\app-release.apk
```

`fullFallback: true` 代表 ppk/pdiff/v2-track 的服务响应同时携带 full 包回退，能验证 Android 下载、安装、PackageInstaller、重启和状态编排，但不能证明真实二进制差分执行。需要真实差分时，按 Harmony 手册同目录 README 的 WSL 流程生成 Android patch，再设置 `RNU_E2E_SKIP_PREPARE=true` 测试。

Android `pdiff` 依赖宿主 Manifest 中的：

```xml
<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />
```

如果修改了 `rn-update/cpp/patch_core` 或 Android JNI，先重建四 ABI 的 `librnupdate.so`，再重新执行本节和上一节；Gradle 只会打包预编译库，不会自动编译仓库根 C++ 源码。

## 6. 快速重跑完整 Android 闭环

当 Release APK 已构建、本地制品已经存在、模拟器状态为 `device` 时，直接执行：

```powershell
$env:E2E_PLATFORM = 'android'
$env:RNU_E2E_SKIP_PREPARE = 'true'
$env:RNU_E2E_FULL_FALLBACK = 'true'

Test-Path '.e2e-artifacts\android\manifest.json'
npm run test:e2e:android
```

该 npm script 等价于：

```powershell
node scripts/run-detox.js android test `
  --configuration android.emu.release `
  --headless `
  --record-logs all
```

Detox 的 global setup 会自动完成：

1. 检查当前工作树 SDK；
2. 校验或生成 Android 制品；
3. 启动本地 Bun server，端口为 `31337`；
4. 预热 `checkUpdate` 和 Android 产物；
5. 启动 Release APK；
6. global teardown 停止本次启动的 server。

不要另开 `npm run server`，否则容易造成 `31337` 端口冲突。

## 7. 测试矩阵与单独入口

### 7.1 Release 主路径

```powershell
node scripts/run-detox.js android test `
  --configuration android.emu.release `
  --headless `
  --record-logs all `
  --retries 1 `
  --maxWorkers 1
```

覆盖：

- `bundle-hash.test.ts`：原生 `bundleHash` 等于 APK 内嵌 `assets/index.android.bundle` 的 SHA-256；
- `local-merge.test.ts / silentAndNow`：full v1 → ppk v2 → Android pdiff v3 → v2-track v4 → 重启 → upToDate；
- `local-merge.test.ts / silentAndLater`：延迟安装的 full、ppk、pdiff、v2-track 逐级重启激活。

最终状态应为：

```text
bundleLabel: E2E_V2TRACK_V4
currentHash: e2e-v2track-v4
lastCheckResult: upToDate
```

### 7.2 Debug 首屏 smoke

Debug smoke 不准备本地更新制品，只验证 Debug Native module 常量初始化和首屏渲染：

```powershell
node scripts/run-detox.js android build --configuration android.emu.debug
node scripts/run-detox.js android test `
  --configuration android.emu.debug `
  --config e2e/smoke/jest.config.js `
  --headless `
  --record-logs all `
  --retries 1
```

通过标准是 `bundle-label` 可见。Debug smoke 通过不等于 Release 更新持久化通过，二者必须分别保留。

### 7.3 原生冷启动 / forceBoot

该 runner 不点击 JS 的 `check-update`，由本地服务的 `forceBoot` 指令驱动原生冷启动检查：

```powershell
$env:RNU_E2E_SKIP_PREPARE = 'true'
node scripts/run-detox.js android test `
  --configuration android.emu.release `
  --config e2e/native/jest.config.js `
  --headless `
  --record-logs all `
  --retries 1 `
  --maxWorkers 1
```

测试结束后必须确认 `forceBoot` 已恢复为 `false`，避免污染后续套件。

## 8. 局域网真机 + 本地 E2E 服务 / 真实服务闭环

### 8.1 真机连接本地 Bun E2E server

`10.0.2.2` 是 Android 模拟器专用的宿主机别名，实体手机必须使用电脑和手机同一局域网网卡的 IPv4。当前机器为 `192.168.1.21`，但每次测试前都应重新执行 `ipconfig` 确认。

保持本地 E2E server 在单独的 PowerShell 中运行：

```powershell
Set-Location $E2eRoot
npm run server # 已安装 Bun 且 bun 在 PATH 时使用
# 如果当前终端仍找不到 bun：
npx --yes bun scripts/local-e2e-server.ts
```

另开 PowerShell，生成绑定局域网地址的真机 APK：

```powershell
Set-Location $E2eRoot
$LanIp = '192.168.1.21'
$env:RNU_E2E_LOCAL_ENDPOINT = "http://${LanIp}:31337"
npm run apk:local-device
```

安装后首屏的 `endpoint` 必须显示 `http://192.168.1.21:31337`。安装前先从手机验证：

```powershell
adb -s $Device shell curl -sS --connect-timeout 5 'http://192.168.1.21:31337/health'
```

返回 `ok` 后再点击 `Check Update`；预期 `lastCheckStatus: completed`，初始基座会得到 `lastCheckResult: update:e2e-full-v1`。如果手机 curl 仍超时，放行 Windows 防火墙对 TCP `31337` 的入站访问，并确认手机没有连接访客 Wi-Fi。

### 8.2 真机连接 Go 真实服务

这一条路径验证真实 `CLI → Go → PostgreSQL → MinIO → Android 真机`，不要用模拟器地址 `10.0.2.2`，也不要把 `127.0.0.1` 打进真机包。

先从 `ipconfig` 找到与手机同一网络的 IPv4。以本机当前地址 `192.168.1.21` 为例：

```powershell
$LanIp = '192.168.1.21'
$ServiceRoot = "http://${LanIp}:55486"
$UpdateEndpoint = "$ServiceRoot/api"
$PublicStorage = "http://${LanIp}:9000/rn-update"
$Device = 'adb devices -l 中状态为 device 的真机 serial'
```

在 Admin 的对象存储设置中保持内部 `endpoint` 不变，只把 `publicUrl` 改成 `$PublicStorage`。`checkUpdate` 响应中的 `paths` 必须是该局域网地址；否则 API 虽然可达，客户端下载 PPK 仍会失败。

在手机 shell 中先验证局域网链路：

```powershell
adb -s $Device shell curl -sS --connect-timeout 5 "$ServiceRoot/health/live"
adb -s $Device shell curl -sS -I --connect-timeout 5 "$PublicStorage/{fullKey}"
```

构建绑定真实 appKey 和局域网服务地址的 Release APK。脚本只在被 Git 忽略的 `.e2e-artifacts/real-service-entry.js` 写入本次配置，默认 Detox 构建不受影响：

```powershell
$env:RNU_E2E_APP_KEY = '{Admin/CLI 中的 appKey}'
$env:RNU_E2E_SERVER = $ServiceRoot # 构建脚本会规范化为 $UpdateEndpoint
# 真服务 test 验收可显式选择原生版本与不可变渠道；不设置时仍为 default/1.84.1
$env:RNU_E2E_CHANNEL = 'test'
$env:RNU_E2E_PACKAGE_VERSION = '1.84.2'
npm run apk:real-service
```

热更新 PPK 必须携带同一组运行时配置；否则第一次更新重启后会退回默认模拟器端点：

```powershell
$env:RNU_CLI_ROOT = Join-Path $RepoRoot 'rn-update-cli'
$env:RNU_E2E_UPDATE_LABEL = 'REAL_SERVICE_UPDATE'
npm run ppk:real-service
Test-Path '.e2e-artifacts\android\real-service.ppk'
```

这个入口改变了 APK 内嵌 bundle，因此必须把新 APK 再执行一次 `uploadApk`，让服务器登记新的 `bundleHash/buildTime`。不能沿用旧 APK 的 native version：

```powershell
$Apk = Join-Path $E2eRoot 'android\app\build\outputs\apk\release\app-release.apk'
Set-Location (Join-Path $RepoRoot 'rn-update-cli')
node lib\bin.js uploadApk $Apk --config $Config --channel $env:RNU_E2E_CHANNEL --no-interactive
node lib\bin.js publish "$E2eRoot\.e2e-artifacts\android\real-service.ppk" `
  --platform android --config $Config --packageVersion $env:RNU_E2E_PACKAGE_VERSION `
  --channel $env:RNU_E2E_CHANNEL --name 'Android 真机局域网热更' --rollout 100 --no-interactive
```

安装、启动和查看 UI：

```powershell
adb -s $Device install -r $Apk
adb -s $Device shell am force-stop com.awesomeproject
adb -s $Device shell monkey -p com.awesomeproject -c android.intent.category.LAUNCHER 1
adb -s $Device shell uiautomator dump /sdcard/rnu-window.xml
adb -s $Device exec-out cat /sdcard/rnu-window.xml
```

首屏必须显示局域网 `endpoint`、`packageVersion: 1.84.2`、`channel: test` 和 `bundleLabel: BINARY_BASE`。点击 `Check Update` 后，`silentAndNow` 会下载并激活发布；应用重启后必须同时满足：

- `bundleLabel` 变为发布 PPK 对应标签；
- `currentHash` 等于 Admin release 的 `hash`；
- 再次检查显示 `upToDate`；
- Admin/遥测出现该真机同一 `hash` 的 `download_success` 与 `mark_success`；若队列 `pending > 0` 且 `active = 0`，启动 `go run ./cmd/worker` 后再查看面板。

### 8.3 test 同 JS 重打包验收

计划中的 A/B 构建必须保持 `RNU_E2E_CHANNEL`、`RNU_E2E_PACKAGE_VERSION`、入口源码和服务地址不变。第一次构建 A 后执行 `uploadApk` 登记；第二次只重新执行 `npm run apk:real-service` 生成 B，不再次登记 B：

```powershell
$env:RNU_E2E_CHANNEL = 'test'
$env:RNU_E2E_PACKAGE_VERSION = '1.84.2'
npm run apk:real-service
$ApkB = Join-Path $E2eRoot 'android\app\build\outputs\apk\release\app-release.apk'
Set-Location (Join-Path $RepoRoot 'rn-update-cli')
node lib\bin.js parseApk $ApkB --json
```

A/B 的 `bundleHash` 必须一致而 `buildTime` 必须不同。将 B 安装到真机后，关闭应用级和 `test` 渠道级 `ignoreTimestampCheck`，点击 `Check Update`；响应诊断应为 `bundleStatus: rebuiltSameJs`，并只返回全量 `full`，没有 `diff/pdiff`。这一步验证的是新构建身份沿用已登记 JS 指纹准入，不是重新登记 B。

当前局域网 IP 可能因 DHCP 改变。每次重测都重新读取 `ipconfig`，同步更新对象存储 `publicUrl` 并重建 APK，禁止把 `192.168.1.21` 当成永久配置。

## 9. 失败时按现象定位

| 现象 | 处理 |
| --- | --- |
| `adb devices` 显示 `offline` | 关闭旧 AVD，执行 `adb kill-server` 后重新启动 `Medium_Phone_API_36.0`，确认状态变为 `device`。 |
| `No connected devices` | 确认 `ANDROID_HOME`、`ANDROID_SERIAL` 和 `DETOX_AVD_NAME`，不要把 Harmony 的 `hdc` 目标与 Android serial 混用。 |
| `errorChecking` 且 `404 page not found` | SDK 会拼接 `/checkUpdate/{appKey}`；确认 UI endpoint 以 `/api` 结尾，使最终路径命中 Go 的 `/api/checkUpdate/{appKey}`。重新构建 APK/PPK 并重新上传基线。 |
| 真机能检查但下载失败 | 查看响应 `paths`；对象存储 `publicUrl` 必须是手机可达的局域网地址，并从手机 `curl -I` 得到 `200`。 |
| App 已热更但 Admin 没有下载记录 | `silentAndNow` 会重启 JS；确认客户端在切换前等待有超时的 `download_success` 回执，并检查 Worker 正在消费 telemetry 队列。 |
| 真机返回 `unknownBundle` | 真服务 APK 构建后遗漏了 `uploadApk`；重新上传当前 APK，不能复用旧 APK 的 bundleHash。 |
| APK 安装后 ADB 消失 | 重新插拔 USB、解锁手机并确认 USB 调试授权；`adb kill-server; adb start-server` 后设备状态必须恢复为 `device`。 |
| `Could not find a connected Android device` | 先单独执行 `adb devices -l`；设备必须已经完成系统启动。 |
| Detox 启动了不存在的 `api34` | 设置 `$env:DETOX_AVD_NAME = 'Medium_Phone_API_36.0'`；本机 AVD 名称不是 CI 的 `api34`。 |
| `INSTALL_FAILED_NO_MATCHING_ABIS` | 保持 `$env:DETOX_ANDROID_ARCHS = 'x86_64'`，清理旧构建后重新 build。 |
| Gradle 提示 Java 版本不兼容 | 设置 `JAVA_HOME` 为本机 Java 17，并确认 `java -version`。 |
| `manifest.json` 不存在 | 取消 `RNU_E2E_SKIP_PREPARE`，先执行 `npm run prepare:e2e`。 |
| `node-hdiffpatch` 原生绑定不可用 | Windows 本机显式用 `RNU_E2E_FULL_FALLBACK=true`；真实 diff/pdiff 改用 WSL 生成。 |
| Android pdiff 安装失败 | 确认 APK 已重新安装、Manifest 有 `REQUEST_INSTALL_PACKAGES`，并查看 Detox log。 |
| `bundleHash` 超时或不一致 | 确认测试使用的是刚构建的 `app-release.apk`，不要让旧 APK 和新制品混用。 |
| `EADDRINUSE: 31337` | 先让上一次 Jest 正常结束；再查看 `.e2e-artifacts\.server.pid`，只停止该 PID，不要按进程名批量杀进程。 |
| Detox 长时间 idle timeout | 保持 runner `maxWorkers=1`，Android 测试已经关闭 `31337` 请求的 Detox 同步；不要并行启动同一 AVD。 |

## 10. 测试结束后的证据

```powershell
Get-Content '.e2e-artifacts\android\manifest.json'
Get-ChildItem '.e2e-artifacts\android' | Select-Object Name, Length
Get-ChildItem 'artifacts' -Recurse -Force -ErrorAction SilentlyContinue | Select-Object FullName, Length
```

主 Release 路径的通过条件不是只有退出码为 0，还要同时满足：bundleHash 断言通过，最终显示 `E2E_V2TRACK_V4`，重启后保持 v4，最后一次检查为 `upToDate`，并且日志中没有安装或回滚错误。
