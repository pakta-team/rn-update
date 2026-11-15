# e2etest

`e2etest` 是专门给 Detox 用的 React Native example，不承担手工演示职责。

依赖锁使用官方 `rn-update@1.1.0` 的真实 registry 摘要，保持冻结安装校验。它只提供包名和安装依赖；Metro 将 SDK JS 与版本元数据固定到本仓库，RN CLI 将 Android/iOS 原生根固定到同一工作树。构建前 `node scripts/assert-local-sdk.js` 会同时验证这些边界及宿主 React/RN 单例，不能把 registry 包安装成功当成本轮候选验证。

验证链路固定为：

- 本地 `rn-update-cli` 生成全量包、`diff` 和 Android `pdiff`
- v1 作为 Hermes HBC epoch，v2/v3/v4 以同一基线生成 ppk/v2-track 差分
- 本地 Bun server 提供 `checkUpdate` 接口和静态产物
- App 侧 `Pakta` client 直接指向本地 endpoint
- `checkUpdate + silentAndNow` 触发自动下载和切包

常用命令：

```sh
bun install
detox build --configuration ios.sim.release
E2E_PLATFORM=ios detox test --configuration ios.sim.release
```

```sh
bun install
detox build --configuration android.emu.release
E2E_PLATFORM=android detox test --configuration android.emu.release --headless --record-logs all
```

`RNU_RN077_OLDARCH_ROOT` 可把生成工作区放在仓库外 TEMP；已有 AwesomeProject 会拒绝覆盖。`RNU_SDK_SHA256` 可绑定预期摘要。生成器把 tgz 复制到工程内，Metro 与 RN CLI 均消费 `node_modules/rn-update`，不借用仓库源码；安装前置检查和 `npm run apk` 的 Release 后置检查分别验证候选字节及宿主/SDK BuildConfig。启动入口另断言真实旧桥，不能仅凭 gradle.properties 判定架构。

真坏JS救援使用[独立入口](scripts/crash-rescue-map.md)，复用明确的Release APK/.app并为每个宿主编译匹配的Hermes PPK。Android的`run-android-crash-rescue.js`串行管理制品、临时服务、设备驱动和证据；iOS使用`drive-ios-crash-rescue.py`。两者都要求已确认坏版本真实fatal、fix此前不可下载且不含forceBoot、原生`crashRescue:true`和修复后重启保持；健康JS的native-check不能替代。离线门卫分别由`python -B scripts/android-crash-rescue.test.py`、`python -B scripts/ios-crash-rescue.test.py`验证，设备结果另行登记。

持久离线回归：`npm run test:rn077-generator`。真实验证与未验范围见 [RN077 地图](scripts/rn077-oldarch-map.md)；这里提供 Detox 命令不代表该矩阵已经通过。

Expo57/RN0.86.3 使用 [Expo 隔离宿主入口](scripts/expo-ota-map.md)：`create-expo-e2e-project.js --project FRESH_DIR --sdk-tarball CANDIDATE.tgz --sdk-sha256 SHA256` 只创建工程，随后显式执行正常 npm 安装、Expo prebuild、`assert-expo-e2e-project.js --project FRESH_DIR --sdk-sha256 SHA256` 和 Release 构建。宿主注册共享UI，完整候选和框架必须物理单源；Babel core/preset为锁定的直接开发依赖，门卫要求从宿主根解析实际入口；明文网络仅允许10.0.2.2。样例目录的 `npm run test:expo-generator` 运行离线输入正负控，`npm run test:runner-boundaries` 用真实 Jest 发现列表检查普通Detox与独立Harmony native套件隔离。

Android 的 package diff 走 `PackageInstaller`，宿主清单声明
`REQUEST_INSTALL_PACKAGES`；因此 release APK、pdiff 和重启后的 bundle 状态都在同一条链上验收。
当前 Windows 开发机的固定 Android SDK/AVD 路径与快速命令见
[`e2e/LOCAL_WINDOWS_ANDROID_TEST.md`](e2e/LOCAL_WINDOWS_ANDROID_TEST.md)。
如果修改了 `cpp/patch_core` 或 Android JNI，必须先用仓库根的 Android NDK 入口重建
`android/lib/*/librnupdate.so`，再重新 assemble release APK；Gradle 会打包这些预编译 ABI，
不会自动编译仓库根 C++ 源码：

```sh
npm run build:so
```

本地 Windows 若没有 Bash，可直接执行已安装 NDK 的 `ndk-build.cmd`，最后运行
`node scripts/verify-android-so.js`。

HarmonyOS 需要先在已连接的设备/模拟器上构建并安装基座 HAP，再运行独立的
`hdc + uitest` runner：

Windows 与临时 runner 统一使用 [Harmony 分阶段入口](scripts/harmony-e2e-map.md)：显式候选 tgz/HAR 摘要 → `stage` → 样例冻结安装 → `sync/prepare/base/build/diff/install/test`。入口固定双 ABI Release、显式 HDC 目标及真实 `fullFallback=false` 门禁，构建/安装摘要避免旧 HAP 混入。原 Bash 构建入口仅保留既有 macOS 工作流。

```sh
npm run build:harmony-e2e
npm run test:harmony-e2e
```

其中 `test:harmony-e2e` 复用刚生成的制品，覆盖 `BINARY_BASE → v1 全量 → v2 ppk
差分 → v4 v2-track 差分 → 重启持久化 → upToDate`；Windows 无法加载原生 hdiff
时，按 `e2e/harmony/README.md` 用 `generate-platform-diffs-wsl.cjs` 生成真实差分。

架构需要跟 AVD 保持一致：Apple Silicon 本地的 `api34` AVD 用
`arm64-v8a`；GitHub `ubuntu-latest` x64 job 用 `x86_64` emulator 和
`DETOX_ANDROID_ARCHS=x86_64`。

RN 0.77.3 旧架构 Android 消费端由生成器创建。必须显式提供本地候选 tgz；不再回退到 npm 版本范围，也不自动 pack 或发布。以下命令从 SDK 根执行：

```sh
RNU_SDK_TARBALL=/absolute/path/rn-update-1.1.0.tgz node Example/e2etest/scripts/create-rn077-oldarch-project.js
cd .e2e-rn077-oldarch/AwesomeProject
bun install
npm run apk
E2E_PLATFORM=android detox build --configuration android.emu.release
E2E_PLATFORM=android detox test --configuration android.emu.release --headless --record-logs all
```
