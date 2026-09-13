# e2etest

`e2etest` 是专门给 Detox 用的 React Native example，不承担手工演示职责。

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

RN 0.77.3 旧架构 Android 兼容性由 CI 运行时生成工程验证：

```sh
node Example/e2etest/scripts/create-rn077-oldarch-project.js
cd .e2e-rn077-oldarch/AwesomeProject
bun install
E2E_PLATFORM=android detox build --configuration android.emu.release
E2E_PLATFORM=android detox test --configuration android.emu.release --headless --record-logs all
```
