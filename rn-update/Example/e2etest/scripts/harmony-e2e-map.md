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
- `build` 要求显式候选 tgz 完整摘要及 `arm64-v8a` 与 `x86_64` 两个 ABI。它先验证已暂存 HAR 与 Hvigor 插件的摘要，只清理确认仍位于显式工程内的 `oh_modules` 和 `entry/oh_modules` 两个生成目录，再 `ohpm install --all`，固定 `buildMode=release` 构建并要求 signed HAP 存在。链接指向工程外时拒绝清理。成功后在制品目录写 `harmony-build-inputs.json`，绑定完整 tgz、工程、生产源码、HAR、插件、base bundle 与 HAP 摘要；即使只改变非 Harmony 文件的新候选也必须重建证明。
- `diff` 不运行 Metro，不再覆写 base bundle；它在 HAP 构建后生成真实 PPK 与 v2-track patch。生成器先将既有 false 证明改为 true，再逐一验证所有 full/patch，全部成功才提交 false。复用既有 false 同样重新校验 ZIP，坏包直接拒绝，不自动修复或执行设备命令。
- `install` 要求显式 `HDC_TARGET`，先复核构建摘要未过时，再只对该目标执行 `install -r`，必须得到 `App installed successfully` 且不含 Fail/Error/unsuccessfully，写入 `harmony-install-inputs.json` 绑定目标、完整 tgz 与 HAP。证书变化时由调用方明确对同一目标卸载旧应用后重试；脚本不会自动选择第一台设备或卸载其它包。
- `test` 固定完整 Harmony Jest runner，不接受任何附加参数或过滤。它强制跳过 global prepare，要求 `manifest.platform=harmony`、`fullFallback===false` 且真实 patch 非空，复核构建/安装证明与当前 tgz/HAP/目标一致，先写 `harmony-run-inputs.json` 并清除旧结果和旧成功证明。Jest 必须输出本次 `harmony-jest-results.json`，当前工程的业务六项及 smoke 三项全部 passed、无 skip/todo，且运行后输入摘要未变，才写 `harmony-test-inputs.json` 绑定候选/HAP/制品、结果 SHA256 与通过数量；命令退出零不足以通过。
- `check` 检查候选、物理 SDK、依赖、构建摘要与真实制品并输出当前摘要；它不代表设备用例已通过。
- `all` 按 `prepare → base → build → diff → install → test` 执行。远程 runner 可复用，开发机并行多平台时建议分阶段调用。

默认每次 `build` 刷新 OHPM。已完成安装、只需重试 Hvigor 时，可显式设置 `RNU_HARMONY_REUSE_DEPENDENCIES=1`：入口先只读校验当前 HAR 完整摘要及其全部文件（本轮 43 个），要求 `entry/oh_modules/pakta` 实际落在当前短项目 `oh_modules/.ohpm` 内，文件清单与每个 SHA256 完全一致，HAR/安装/锁版本相等，entry manifest 固定 `file:../pakta.har` 且锁的唯一 Pakta 引用为当前 `../pakta.har` 本地文件。全部通过才跳过清理和 `ohpm install`，继续 Hvigor；任何不符直接失败，不自动重装或接受旧缓存。`0` 或未设置继续默认刷新，其它值拒绝。

复用门卫不解包到工程；只读解析 gzip/TAR，拒绝损坏/截断、重复或大小写碰撞路径、路径穿越、链接成员、安装树内部 junction/软链接及隐藏的额外文件。它只证明本地 Pakta HAR 依赖，既不证明 RNOH/SDK 编译兼容，也不证明 HAP 已构建；不要在校验与构建期间并发修改工程输入。

## Windows 真实差分

WSL 中需已安装 Linux Node、当前 CLI 与可加载的 `node-hdiffpatch`；复用既有变量，不把 Windows 原生加载失败变成差分成功：

```powershell
$env:RNU_WSL_CLI_ROOT = '/path/to/current/rn-update-cli'
$env:RNU_WSL_HDIFF_ROOT = '/path/to/linux/node_modules'
# 可选：$env:RNU_WSL_DISTRO = 'Ubuntu'
# 可选：$env:RNU_WSL_NODE = '/path/to/node'
npm run harmony:e2e -- diff
```

脚本经 `wslpath` 转换当前实际制品目录与生成器路径，并用独立 argv 传入，不拼接 shell 命令。生成器明确采用 Harmony 的 v2→v4 基线。共享门卫依赖样例已锁定的 node-stream-zip，不读取整份大包：定位读取 local/central/descriptor，逐条流式计算实际大小与 CRC，验证中央目录连续跨度和 EOCD 精确边界，要求非空 bundle/patch 与合法 __diff.json。沿用 SDK contract.json 的归档、单条、总展开量、数量与压缩比预算，元数据和实际流各自限额；同步编排通过有期限子进程调用同一门卫。fullFallback=false 必须与完整 ZIP 门卫同时成立。

## 验证与证据边界

### 独立原生与失败 JS 设备验收

原九项仍由 `harmony:e2e test` 完整执行。`harmony:native` 另用显式 `RNU_HARMONY_NATIVE_PROJECT` 短工程，必须与原 `RNU_HARMONY_PROJECT` 和源码工程不同；调用方准备该副本与签名，入口不会复制证书或自动创建工程。两种原生验收各保留 `.e2e-artifacts/harmony-native/<healthy|crash>` 的构建/安装/Jest/轨迹/HAP，禁止覆盖或借用原九项结果。

```powershell
$env:RNU_HARMONY_NATIVE_PROJECT = 'D:\harmony-native-short'
npm run harmony:native -- healthy all
npm run harmony:native -- crash all
```

两种模式都先 `init` 复制并绑定已验真的五制品及 manifest，再 `base → build → install → test`；可按相同阶段单独重试，`check` 只做身份检查。healthy 使用正常 base，crash 使用已有 `entry.crashprobe.ts`，在原生五秒调度前抛出一秒 JS fatal。构建仍消费相同显式候选/HAR与双 ABI Release，故障入口源码及已编译基座摘要写入独立构建证明。入口同时检查基座实际字节中的故障 marker，拒绝未重新 bundle 的错用例 HAP。

独立测试不点击 JS 更新按钮、不写 KV。每个模式先从仅清理测试应用数据的状态证明 forceBoot=false 的真实原生检查/下载不激活，随后再次清理测试应用，证明 forceBoot=true 的全新检查/下载可激活并正常 markSuccess、重启保持。crash 还必须取得当前存活 PID 的新 fatal 原始 hilog，日志须先于服务端原生请求，且下载后仍为同一 PID；缺 marker、旧 PID/旧日志、缺下载或仅有标签均失败。`local-e2e-server.ts` 的只读 `/state` 给出检查与 GET 制品请求时间，服务夹具和独立副本须在运行前后全部摘要一致。

`harmony-native-validation.json` 只在固定单套 Jest 全通过、当前 runId 轨迹通过、输入未变且实际 HAP 已独立归档后生成。它与原九项的证明分别登记；Node 证据门卫正负控不能代替这两次真实设备运行。

`npm run test:harmony-orchestrator` 跑编排、结果与 ZIP 三组持久 Node 正负控；新增缺首53字节、local/central/descriptor/CRC、必需条目、清单形状、解压预算和旧 false 重生失败负控。复用坏 ZIP 与坏 HAR 均须零设备命令拒绝。Windows runner 在冻结安装样例依赖后先执行本命令；测试不调用真实 Hvigor、模拟器或设备，不冒充平台通过。

设备套件使用本地 `31337` 端口，与 Android 本地 E2E 必须顺序运行；构建阶段可以并行。业务六项逐阶段校验 current-hash、lastError 和原生 getUpdateMetadata().rolledBackVersion，重启后仍要求 v4/hash 一致且无错误/回滚。增加观测 UI 后须重新 prepare→base→build→diff；旧 HAP 缺字段应失败。实际通过仍需记录候选/HAR 摘要、构建日志、`check`、设备目标、Jest JSON 与成功证明。现有 `LOCAL_WINDOWS_TEST.md` 保留机器路径手册，本文记录共用入口。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
