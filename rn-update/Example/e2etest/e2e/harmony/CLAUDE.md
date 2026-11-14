# harmony/
> L2 | 父级: ../CLAUDE.md

HarmonyOS 端到端套件。global hooks 维护 hdc 设备上的本地服务，测试只通过 HarmonyDriver 观察 bundle label、更新按钮和持久化结果，平台差异不泄漏到 JS SDK 生产层；重新生成制品时由外部 `rn-update-cli >=1.0.0` 提供 bundle 入口，Windows 真差分再由 WSL 旁路完成。

## 成员清单

CLAUDE.md: Harmony runner 与测试成员地图
globalSetup.js: 构建准备并启动 Harmony 专用本地更新服务，以单飞 HTTP 探活避免重试计时器与 TCP 句柄泄漏
globalTeardown.js: 停止 Harmony 专用本地更新服务、撤销 hdc reverse 端口并清理 pid 文件
server-process.js: 校验 pid 是否仍属于 local-e2e-server，并提供跨平台安全停止原语
local-update.test.ts: full/ppk/v2-track 更新流和 markSuccess/upToDate；每个阶段及重启后同时断言真实 current-hash、lastError 为空、原生 rolledBackVersion 为空，拒绝仅标签匹配的假绿
README.md: Harmony e2e 前置设备、构建与运行说明
LOCAL_WINDOWS_TEST.md: 当前 Windows + DevEco Studio 机器的固定路径、快速命令、Release HAP 和故障排查手册
smoke.test.ts: hdc/uitest 驱动、首屏元素和重启 smoke 验收

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
