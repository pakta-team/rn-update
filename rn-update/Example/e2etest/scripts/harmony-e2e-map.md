# Harmony 跨平台 E2E 编排
> L2 补充 | 父级: ./CLAUDE.md

`run-harmony-e2e.js` 只编排已经存在的候选、工具链、工程与设备。Windows 本机与临时 runner 共用 `npm run harmony:e2e -- <phase>`；签名、模拟器创建、样例依赖安装由调用方准备，入口不会把证书或密码写入仓库。依赖尚未安装时可直接 `node scripts/run-harmony-e2e.js stage`，不要求 e2etest 或样例先安装 Node 包。

## 输入

在 `Example/e2etest` 目录运行。Windows 示例中的路径与摘要须由本轮候选实际值填写，不可复用历史摘要：

```powershell
$env:RNU_HARMONY_SDK_TGZ = 'C:\artifacts\rn-update-candidate.tgz'
$env:RNU_HARMONY_SDK_SHA256 = '<完整 64 位候选 SHA256>'
$env:RNU_HARMONY_HAR_PATH = 'D:\workspace\rn-update\harmony\pakta.har'
$env:RNU_HARMONY_HAR_SHA256 = '<完整 64 位 HAR SHA256>'
$env:RNU_HARMONY_PROJECT = 'D:\harmony-e2e-short'
$env:DEVECO_STUDIO_HOME = 'C:\Program Files\Huawei\DevEco Studio Release'
$env:DEVECO_SDK_HOME = Join-Path $env:DEVECO_STUDIO_HOME 'sdk'
$env:HDC_PATH = Join-Path $env:DEVECO_SDK_HOME 'default\openharmony\toolchains\hdc.exe'
$env:HDC_TARGET = '<hdc list targets 中明确选择的目标>'
```

`RNU_HARMONY_PROJECT` 必须已含 `hvigorfile.ts`、`entry/` 和本机有效签名；Windows 强制显式短路径。`DEVECO_HOME` 为已有兼容别名，`HVIGOR_NODE_PATH` 可显式选择 DevEco 的 Node。默认优先使用 DevEco 自带 Node 执行 ohpm/Hvigor，规避较新 Node 移除旧文件系统接口。

`sync` 校验完整 tgz 摘要，将其解包到本次临时目录，逐字节比较 `src` 的生产源码，再仅替换样例 `node_modules/rn-update`。它不会复制 SDK 根 `node_modules`，并断言 SDK 和样例解析到同一套样例内 React 18、RN 0.72.5、RNOH 0.72.96。没有指定 tgz 时只验证已有物理安装；指向 SDK 根的链接、额外生产源文件或嵌套开发依赖均拒绝。

首次安装先运行 `stage`：它只核对候选摘要并复制到样例忽略目录 `.local-sdk/rn-update.tgz`。样例 manifest 固定 `file:.local-sdk/rn-update.tgz`，调用方随后在样例目录执行 `bun install --frozen-lockfile --backend copyfile`，再运行 `sync`。更换候选须由维护者更新审查锁文件；禁止 `file:../..`，Bun 会把 SDK 根开发依赖和另一个 RN 版本带入宿主。

## 阶段顺序

```powershell
npm run harmony:e2e -- stage
# 调用方在 harmony_use_pakta 目录完成冻结依赖安装后再继续。
npm run harmony:e2e -- sync
npm run harmony:e2e -- prepare
npm run harmony:e2e -- base
npm run harmony:e2e -- build
npm run harmony:e2e -- diff
npm run harmony:e2e -- check
npm run harmony:e2e -- install
npm run harmony:e2e -- test
```

- `prepare` 复用已有制品准备器。Windows 先生成 v1/v2/v4 full 输入并显式标记 `fullFallback=true`，此时不能作为真实差分证明；已就绪时可设置 `RNU_E2E_SKIP_PREPARE=true`。
- `base` 先同步候选，再运行样例原有 `bundle-harmony --dev false --entry-file e2e/entry.base.ts`。制品准备会覆写 rawfile bundle，所以此阶段必须在 `prepare` 之后。对独立短工程，只同步 rawfile、显式 HAR、SDK Hvigor 插件，改写该副本的本地依赖和 `PAKTA_CPP_DIR` 引用；后者指向当前 SDK native glue 并由构建门禁复核，源工程与签名不变。
- `build` 要求 `arm64-v8a` 与 `x86_64` 两个 ABI。它先验证已暂存 HAR 与 Hvigor 插件的摘要，只清理确认仍位于显式工程内的 `oh_modules` 和 `entry/oh_modules` 两个生成目录，再 `ohpm install --all`，固定 `buildMode=release` 构建并要求 signed HAP 存在。链接指向工程外时拒绝清理。成功后在制品目录写 `harmony-build-inputs.json`，绑定工程、生产源码、HAR、插件、base bundle 与 HAP 摘要。
- `diff` 不运行 Metro，不再覆写 base bundle；它在 HAP 构建后复用 `generate-platform-diffs-wsl.cjs` 生成真实 PPK 与 v2-track patch。原生平台的准备器若已产出真实差分，只验证并复用。
- `install` 要求显式 `HDC_TARGET`，先复核构建摘要未过时，再只对该目标执行 `install -r` 并核对 hdc 的成功输出，写入 `harmony-install-inputs.json` 绑定目标与 HAP。证书变化时由调用方明确对同一目标卸载旧应用后重试；脚本不会自动选择第一台设备或卸载其它包。
- `test` 复用现有 Harmony Jest runner，不改变设备 driver。它强制跳过 global prepare，要求 `manifest.platform=harmony`、`fullFallback===false` 且真实 patch 非空，并复核构建/安装摘要与当前 HAP、候选和目标一致，向忽略目录写入候选/HAR/HAP/制品摘要 `harmony-run-inputs.json` 后才运行设备测试。
- `check` 检查候选、物理 SDK、依赖、构建摘要与真实制品并输出当前摘要；它不代表设备用例已通过。
- `all` 按 `prepare → base → build → diff → install → test` 执行。远程 runner 可复用，开发机并行多平台时建议分阶段调用。

## Windows 真实差分

WSL 中需已安装 Linux Node、当前 CLI 与可加载的 `node-hdiffpatch`；复用既有变量，不把 Windows 原生加载失败变成差分成功：

```powershell
$env:RNU_WSL_CLI_ROOT = '/path/to/current/rn-update-cli'
$env:RNU_WSL_HDIFF_ROOT = '/path/to/linux/node_modules'
# 可选：$env:RNU_WSL_DISTRO = 'Ubuntu'
# 可选：$env:RNU_WSL_NODE = '/path/to/node'
npm run harmony:e2e -- diff
```

脚本经 `wslpath` 转换当前实际制品目录与生成器路径，并用独立 argv 传入 `wsl.exe --exec env ...`，不拼接 shell 命令。生成器明确采用 Harmony 的 v2→v4 基线。`manifest.fullFallback=false` 是必要门禁，不能以 Jest 绿色或 full 包下载成功替代。

## 验证与证据边界

`npm run test:harmony-orchestrator` 使用 Node 内置测试器跑持久正负控，验证身份摘要、物理隔离、错误制品与设备目标拒绝、生成目录安全范围和 Release 命令边界。它不调用真实 Hvigor、模拟器或设备，不能冒充 HAP/真实差分/E2E 通过。

设备套件使用本地 `31337` 端口，与 Android 本地 E2E 必须顺序运行；构建阶段可以并行。实际通过仍需记录候选与 HAR 摘要、构建日志、`check` 输出、设备目标、Jest 结果和重启后 v4 持久化，无 `rolledBackVersion`/`lastError`。现有 `LOCAL_WINDOWS_TEST.md` 保留机器路径手册，本文记录共用入口。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
