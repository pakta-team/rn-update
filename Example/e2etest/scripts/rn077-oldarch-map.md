# RN077 旧架构消费地图
> L2 补充 | 父级: ./CLAUDE.md

## 数据流与门卫

`RNU_SDK_TARBALL` → 共享 package-candidate 身份/可选摘要检查 → CLI 15.0.1 的 RN 0.77.3 模板 → 工程内 rn-update-candidate.tgz → 安装树 → Metro/CLI 同根 → Release → 启动旧桥断言。

生成器保留 React 18.3.1、RN 0.77.3、CLI 15.0.1、Detox 20.51.4 和原有类型依赖约束；不升级生产依赖或改锁。复制 JS 与 Node 两份 TypeScript 配置，移除主宿主指向仓库源码的类型别名，使类型解析与 Metro/CLI 一同归安装树。`tsconfig.node.json` 是 prepare/global hooks 的必需输入，不能遗漏；历史删除复制项的记录不代表该入口可用。不存在的深层目标父目录先创建。工作区已有工程则拒绝覆盖，不清空 TEMP 或删除证据。

`assert-rn077-oldarch.js` 检查 tgz SHA-256、安装版本和关键 JS/旧架构 Java 字节、RN077 精确版本及 JS/native 路径一致性；Release 模式要求宿主/SDK 两份 BuildConfig 都为 false 且 APK 存在。它不宣称全归档逐文件校验或运行时通过。

`rn077-runtime-proof.js` 在注册应用前要求 RN=0.77.3、bridgeless/turbo/fabric=false、legacyBridge=true、NativeModules.Pakta 存在且与 SDK UpdateModule 同对象；失配直接抛错。`rn077-oldarch.test.js` 离线执行真实 harness 复制和正负控；模板初始化使用夹具，不冒充 CLI/Gradle/设备。

## 2026-11-14 分层证据

复用 `%TEMP%/pakta-rn077-oldarch-20261114-101758`：verified-result.json、build-retry.log、runtime-1.log/runtime-2.log。tgz SHA-256 `a2f0cc24a4cce81c3c506b64b56641a4044611a961370f9d6d75b61487b7bcd7`；旧 smoke APK SHA-256 `7e7ddc210b30a2deb094c7b685c0945df6c03e2abee23d366921288339f615fa`。原记录 RN077/React18.3.1、双 BuildConfig false、104任务 Release 和 API36 x86_64 两次独立进程 PAKTA_OLDARCH_PASS，包括 hash、KV、cache、reset、markSuccess 桥调用；无待确认版本时 markSuccess=false 不代表激活成功。本轮不重复设备 smoke。

修复后另在 `%TEMP%/pakta-rn077-generator-20261114/AwesomeProject` 运行真实 CLI 生成、bun install 消费上述同一 tgz、安装门卫、`node scripts/run-gradle.js assembleRelease --offline --max-workers=2 --console=plain` 与 `node scripts/assert-rn077-oldarch.js --release`，均通过；Gradle 104任务全部执行。新 APK SHA-256 `6a1e8fa9ea94e86d8849689fad7f89a13af097dd3c0ff8ef7bafdb7ebca2f967`。初次显式 Java home 参数因 Windows 空格分词失败，去除多余覆盖、沿用既有 JAVA_HOME 后通过，未调整依赖解决。

新增持久 Node 回归 3项通过/0失败/0跳过，接入 SDK 常规 test 和独立 test:rn077-generator。生产 SDK 和主 E2E 依赖声明及锁不升级，TEMP 安装有独立解析树。

## 验收边界

2026-11-14至15日后续设备轮使用新的 `989603f4…` 正常发布准备候选，独立重生 HBC96 四 PPK 与真实三补丁。新 Release APK `837eb3e4…` 与设备拉回摘要一致；core 3套/5项、native 1套/1项全部通过，覆盖旧桥实际 full/diff/pdiff/v2-track 两策略与补丁失败保持/重启。此前历史 tgz/旧 smoke 不与本轮合并，完整输入身份、临时依赖镜像与未验边界见 [设备矩阵](../e2e/ANDROID_DEVICE_MATRIX.md)。

上节历史生成器 Release 不等于当轮新 APK 设备通过；历史设备 smoke 绑定旧 TEMP APK。历史两轮均复用既有 SDK SO、不重编 C++，当轮 tgz 来自原 TEMP `npm pack --ignore-scripts`，不具备完整 prepack/release:prepare 发布闸门背书。后续矩阵补齐了当前候选的完整 Detox 与真实差分，但仍未证明全 ABI/其他平台或真正坏 JS 救援；不提交、不发布。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
