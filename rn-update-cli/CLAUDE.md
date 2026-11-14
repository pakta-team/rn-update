# rn-update-cli/
> L2 | 父级: ../CLAUDE.md

独立 CLI/CI 发布工具。原生包解析器读取包内 `channel`（缺省 `default`），`--channel` 只做断言；opaque `buildTime` 按字符串透传。CLI 只有中文 locale 使用中文文案，其余语言统一使用英文，显式 `RNU_LANG` 优先于 POSIX locale 和系统 locale。除 me 命令外，每条命令执行前经 `src/account.ts` 以缓存优先展示账号/套餐状态，并由 detached 的 `account-worker` 后台刷新缓存（本地时钟判定续费窗口，数据源为 `/membership/me` 快照）；standalone 上传/发布遇到缺失渠道时按 code 自动创建；uploadApp 上传精简包并登记 packageKey/downloadUrl/Range 元数据，Hermes base 走管理 API，默认以二进制字面量、pretty dump 与 raw 操作数审计校验 base 等价性（DefineOwnById* 字符串操作数折叠 `<str>` 交 raw 核对），上报 detail 经 failure-fingerprint 脱敏并附 hermesBaseFingerprint 分组指纹，并以有界子进程失败安全回退 plain；服务端适配在 `src/api.ts` 与命令层收敛。

成员清单

LICENSE: MIT 授权正文，署名 Yoghourt Technology(BeiJing) Company Limited，随 npm 包分发
package.json: npm 搜索描述与 OTA/Expo/HarmonyOS 关键词、README 横幅发布清单；独立仓库 `git+https://github.com/pakta-team/rn-update-cli.git` 的 CLI 发布元数据、MIT 许可与公司署名，定义公开入口、制品清单和构建命令；版本由仓库级 scripts/release-version.js 同步；生产源码不依赖 fs-extra/node-fetch/form-data/properties，fs-extra 仅供测试与 fuzz 开发使用
bun.lock: CLI 运行与开发依赖的锁定树，fs-extra 仅列入开发依赖，传递依赖按实际消费者保留

readme-banner.svg: README 共用的 SVG 流程横幅，内嵌 admin-web/public/pakta-logo.webp 原始字节并对齐前端暖纸/墨黑/信号橙主题；无运行时外链，随 npm 包分发
README.md: 英文产品与发布入口，以三步发布、能力速览和命令表呈现主路径，折叠保留 Hermes、Provider API 与环境配置
README.zh-CN.md: 与英文入口对齐的中文发布指南，保留多渠道 CI、零写入预检与全量投放默认值，并随 npm 包分发

tests/: CLI 命令、上传、Hermes、差分与运行时回归测试；package.test.ts 锁定 standalone 原生制品绑定与缺失渠道自动创建
bunfig.toml: Bun 测试根目录与预加载隔离配置，默认将兼容性回归固定在显式旧路由兼容模式
scripts/: 跨平台构建、发布准备、Node 运行时烟雾与差分性能探针
docs/: Hermes base 等价校验的覆盖范围、失败语义与排查手册
src/package.ts: 原生包登记命令，解析版本、bundleHash、opaque buildTime 与 channel；缺失渠道自动创建，上传前短路精确重复并拒绝同渠道同版本换 JS
src/versions.ts: full 制品发布（交互模式保留上传后绑定选择）、批量目标/草稿重试与逐构建 pdiff 登记，携带 channel 进入服务端发布组参数
src/types.ts: CLI 公共选项与原生包/发布模型，声明 channel 和目标组字段
src/utils/index.ts: APK/AAB/IPA/Harmony 原生包元信息读取器，固定 channel 来源并阻止数字化 buildTime
src/account.ts: 账号/套餐状态展示层，缓存优先（`~/.cache/pakta-cli/accounts/`，按 cwd+token 哈希隔离）并派发 detached worker 后台刷新；30 天续费窗口用本地时钟判定，被 bin 前置提醒与 user.me 消费
src/account-worker.ts: 隔离刷新进程，require.main 守卫，15s deadline，拉取 `/membership/me` 快照展平后以 0600/0700 原子写缓存并回传父进程
src/user.ts: login/logout/me 身份命令；me 汇总 `/auth/me` 身份与 `/membership/me` 套餐快照并打印账号摘要
src/bin.ts: CLI 进程入口，统一参数解析、会话恢复、命令调度与错误出口；me 之外的命令前置输出账号/续费状态
cli.json: 命令参数白名单，定义 upload/publish/registerPdiff/update 的 channel、targets、deploymentIds（releaseIds 仅作旧别名）与精确构建选项

渠道身份：包内 channel 保留大小写，--channel 严格断言；共享解析精确优先，仅唯一大小写兼容，歧义在写前失败。整批 targets 先预检再自动创建；服务端只支持小写新 code，缺失混合大小写身份拒绝创建替代渠道，历史 Beta/beta 仍可精确定位。

CLI-09 续核：auto-update 复用用户缓存目录、环境开关和 PackageManager 类型，同时保留原类型导出；provider 的消息命令委托数据命令的同一会话/错误边界。补齐上游 PPK 不可写、ZIP 早期失败及 Sentry 单探针/三类回退共 6 项回归，Sentry 夹具使用临时 JSON 传参以跨 Windows/Bun 子进程运行；E2E 伪存储收完请求体再响应。2026-11-14 本地 lint/build/smoke 与全量 659 pass/69 skip/0 fail 通过，日志位于仓库外 TEMP/pakta-cli-sync-audit-20261114；69 skip 保留 Hermes/原生差分环境边界，不计通过，不替代 Actions 或设备验收。

法则: 包内身份优先·buildTime 不透明·dry-run 零写入·凭据按服务地址隔离

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
