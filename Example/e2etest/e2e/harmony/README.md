# HarmonyOS e2e

当前 Windows 开发机的快速执行入口见 [LOCAL_WINDOWS_TEST.md](./LOCAL_WINDOWS_TEST.md)。

基于 `hdc + uitest` 的轻量驱动（`../harness/harmony-driver.ts`），不依赖 Detox。
被测 App 是 `Example/harmony_use_pakta`（RN 0.72——RNOH 尚不支持 e2etest 的 RN
版本），以 `e2e/entry.base.ts` 为入口构建，UI 与 e2etest 的 `src/index.tsx`
对齐（testID：`bundle-label` / `check-update` / `current-hash` 等）。

定位方式：RNOH 会把 RN 的 `testID` 透传为 ArkUI 节点 `id`（`uitest dumpLayout`
可见）；断言用可见文本（ArkUI 的 `checked`/`selected` 属性不反映 RN 状态）。

## 运行

```bash
# 全套（会先跑 prepare 重新生成 v1/v2/diff 产物并起本地服务器）
npm run test:e2e:harmony

# 跳过产物生成（产物已就绪时迭代更快）
RNU_E2E_SKIP_PREPARE=true npm run test:e2e:harmony
```

### Windows 生成真实 Harmony 差分

Windows 上的 `node-hdiffpatch` 可能没有可加载的原生绑定。此时先只生成
bundle/full 制品，再在 WSL 中运行仓库提供的旁路脚本；脚本会校验
`rn-update-cli >= 1.0.0`，生成真实 `v1-to-v2.ppk.patch` 与
`to-v4.v2track.ppk.patch`，并把 `manifest.json.fullFallback` 改回 `false`：

```powershell
# PowerShell：只生成 bundle 与 full 制品，不把占位 patch 当成真差分
$env:E2E_PLATFORM = 'harmony'
$env:RNU_E2E_FULL_FALLBACK = 'true'
npm run prepare:e2e
```

```bash
# WSL：三个路径都使用 WSL 路径；HDIFF_ROOT 目录下必须有 node-hdiffpatch
RNU_WSL_PLATFORM=harmony \
RNU_WSL_CLI_ROOT=/path/to/rn-update-cli \
RNU_WSL_HDIFF_ROOT=/path/to/node_modules \
RNU_WSL_ARTIFACT_DIR=/mnt/d/code/rn-update/rn-update/Example/e2etest/.e2e-artifacts/harmony \
node /mnt/d/code/rn-update/rn-update/Example/e2etest/scripts/generate-platform-diffs-wsl.cjs
```

生成成功后回到 PowerShell，以 `RNU_E2E_SKIP_PREPARE=true` 运行套件。若只为
验证 UI/服务编排而无法准备 Linux hdiff，必须显式设置
`RNU_E2E_FULL_FALLBACK=true`；该模式不覆盖真实 PPK/v2-track 差分，不能作为
原生差分兼容性的通过证据。

套件：`local-update.test.ts`（完整更新流：BINARY_BASE → v1 全量 → v2 ppk 差量 →
重启持久化 → upToDate）；`smoke.test.ts`（驱动自检）。

## 前置条件

0. **制品工具**：完整重新生成 Harmony bundle/PPK 需要独立的
   `rn-update-cli >= 1.0.0`。CI 会 checkout 到工作区兄弟目录；本地
   可设置 `RNU_CLI_ROOT` 指向已安装并构建的 CLI。Windows 无法加载原生 hdiff
   时，按上文先生成 full 制品，再在 WSL 生成真实差分。

1. **模拟器/真机**在 `hdc list targets` 中可见。命令行启动模拟器：

   ```bash
   nohup /Applications/DevEco-Studio.app/Contents/tools/emulator/Emulator \
     -hvd api20 -path ~/.Huawei/Emulator/deployed -imageRoot ~/Library/Huawei/Sdk &
   ```

   必须显式传 `-imageRoot`（实例 config.ini 的 sdkPath 可能指向失效路径）；
   启动即退且日志报 hdc 超时时，先 kill 残留的旧 hdc server。

2. **基座 hap** 已安装（bundle 默认 `com.charmlot.testpakta`，可用
   `RNU_HARMONY_BUNDLE_NAME` 覆盖）。一条命令完成（本地 har → 换包 →
   刷新 oh_modules → 产物 → 基座 bundle → 出签名包 → 安装）：

   ```bash
   # 仓库根目录；SKIP_HAR=true 跳过 har 重建，SKIP_INSTALL=true 只构建不安装
   npm run build:harmony-e2e
   ```

   脚本：`scripts/build-harmony-e2e.sh`，各步骤的顺序约束和原因见脚本头注释。

3. **签名**：`build-profile.json5` 引用 `~/.ohos/config` 下的自动签名材料。
   调试 profile 与 bundleName 绑定——改 bundleName 后必须在 DevEco 重新自动
   签名，否则 SignHap 报 00303074。

## 已知坑（都踩过）

- 基座必须是 release hap（`build-harmony-e2e.sh` 默认 `-p buildMode=release`，
  可用 `RNU_HARMONY_BUILD_MODE` 覆盖）：debug hap 下 JS 层 `markSuccess` 被
  跳过，第一次更新看似成功、重启即回滚。
- `pakta bundle --platform harmony` 会把工程的 `rawfile/bundle.harmony.js`
  当中间产物**覆写**——产物准备必须在基座 bundle 之前跑。
- ohpm 对 `file:` har 依赖有内容哈希缓存，har 重建后 hvigor 不会自动刷新
  `oh_modules`（会一直用旧 har）——删 `oh_modules` + `entry/oh_modules` 后
  `ohpm install --all`。
- 换签名证书后 `hdc install -r` 报 9568332 sign info inconsistent，必须先
  `hdc uninstall`。
- hdc 的 rport 映射在连接重握手后**静默丢失**；driver 的 `rport()` 幂等，
  测试 beforeAll 每次重建。重复建立时 hdc 输出 `[Fail]TCP Port listen failed`
  =已存在，非错误。
- `uitest uiInput click` 成功输出 `No Error`。
- npm 版 10.39.1 的 `joinUrls` 会给已含 scheme 的 paths 再拼 `https://`，
  连不上本地 http 服务器（报 Couldn't resolve host name）——必须用本地
  rn-update（仓库代码已修复）。

## CI

workflow 已写好：`.github/workflows/e2e_harmony.yml`（仅 `workflow_dispatch`
触发，**尚未启用**——需要先注册一台自托管 runner，labels:
`self-hosted, macOS, harmony`，机器准备事项见 workflow 头注释）。

GitHub 托管 runner 跑不了：Linux 无鸿蒙模拟器；macOS/Windows 托管 runner
无嵌套虚拟化（模拟器在 Windows 上还明确拒绝 VM 环境）；模拟器镜像需华为
账号在 DevEco 内下载，临时环境无法自动供给。
