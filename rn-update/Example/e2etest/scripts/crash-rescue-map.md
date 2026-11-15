# 真坏 JS 崩溃窗口救援
> L2 补充 | 父级: ./CLAUDE.md

现有 native-check 只证明健康 JS 不主动检查时 native forceBoot 生效。当前入口要求已确认的坏版本自身 armed 后真实 fatal，fix 在此前不能下载，修复响应完全不含 forceBoot，原生 hashInfo 必须保存 `crashRescue:true`。不得把自动回滚、普通冷启动切包或测试驱动写 KV 计为救援。

## 制品与服务

复用现有 Release APK/.app，不重建原生。每个 RN 宿主分别编译 Hermes full PPK；RN077、RN085、Expo 的字节码不可互换。`prepare-crash-rescue-artifacts.js` 参数为 `--project HOST --cli CLI_ROOT --output FRESH_DIR --platform android|ios [--bundler react-native|expo]`；输出 `brick.ppk`、`fix.ppk`、两份构建日志及 `build-proof.json`。证明状态 `built` 表示编译成功，记录宿主/RN/SDK/CLI、三个入口摘要与两份 PPK 大小/摘要，不代表设备通过。入口均加载该宿主原有 index，Expo 保留 registerRootComponent；fix 复用旧修复入口并只读原生 hashInfo 输出 `PAKTA_CRASH_RESCUE_PROOF`。

共享服务启动：`node crash-rescue-server.js --artifacts FRESH_DIR --evidence FRESH_STATE_JSON --run-id UNIQUE_ID --port 31337 [--host 0.0.0.0]`。证据文件必须不存在。`GET /state` 返回 runId、phase、hashes、files、requests、artifacts、transitions；所有事件有递增 seq、UTC at 与 phase。requests 保留请求 hash/body、返回 hash 和 forceBoot；artifacts 保留 HEAD/GET、文件名和 HTTP 状态。服务不写 SDK 状态或制造 crashRescue。

| 阶段 | 检查响应 | 制品访问 |
| --- | --- | --- |
| brick | 空 hash → e2e-rescue-brick，config.forceBoot=true；其他 upToDate | brick.ppk 开放，fix.ppk HEAD/GET 均 404 |
| rescue | brick hash → e2e-rescue-fix，无 config/forceBoot；其他 upToDate | 只开放 fix.ppk |
| sealed | 全部 upToDate | 全部制品 404 |

阶段单向迁移：`POST /control/phase` JSON `{"phase":"rescue","evidence":{"armed":true,"fixAbsent":true}}`，驱动必须先通过真实设备 armed/无预下载观察；随后 `{"phase":"sealed"}`。服务只验证证据形状并留痕，不替驱动证明其真实性。新轮使用新服务实例与新证据目录。

## Android 驱动

完整入口：`node scripts/run-android-crash-rescue.js --project HOST --cli CLI_ROOT --apk RELEASE_APK --serial SERIAL --package com.awesomeproject|space.yoghourt.pakta.expoprobe --output FRESH_DIR [--artifacts BUILT_DIR] [--bundler expo] [--adb ADB] [--python PYTHON] [--apk-sha256 SHA]`。默认独立准备PPK；复用模式要求build-proof绑定同一宿主/CLI，并先离线验证APK/PPK摘要与HBC版本。输入通过后启动本进程31337服务、异步执行设备驱动并始终关闭自有服务；成功后再次核APK/PPK未变，保留run-result、输入验证、server-state及device证据。不要与其它31337设备套件并行。

`drive-android-crash-rescue.py --serial SERIAL --package com.awesomeproject|space.yoghourt.pakta.expoprobe --apk RELEASE_APK --apk-sha256 SHA --artifacts FRESH_DIR --evidence-dir FRESH_DIR --run-id UNIQUE_ID [--adb ADB] [--server http://127.0.0.1:31337]`。`--verify-only` 只检查 APK/PPK 构建证明与摘要，不访问设备。

驱动只清理上述已知样例包，安装明确 APK；验证 base→native forceBoot brick、真实 markSuccess 与 armed，再以 fix 封锁的一次 fatal 证明坏 JS，随后开放无 forceBoot fix 并观察下一次真实 fatal/崩溃窗口下载/进程退出。恢复启动必须显示 FIXED/hash、读取原生 crashRescue=true，并在 sealed 后再次重启保持。全过程无 Check Update 点击、无 SharedPreferences/安装目录注入。该脚本编写完成和离线服务测试均不代表 RN085/RN077/Expo 设备已验收。

iOS 由 `drive-ios-crash-rescue.py` 使用 simctl、真实 crash report PID 与只读 plist/安装目录验证同一服务协议；其输入和执行证明由 iOS 平台流程单独登记。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
