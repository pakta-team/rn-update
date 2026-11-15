# test/
> L2 | 父级: ../CLAUDE.md

HarmonyOS 回归验证层。测试只证明错误码契约、Content-Range 解析、安装记录纯逻辑、DownloadTaskParams、EventHub、Manifest 解析与输入校验；check-constant-parity.js 守门 ArkTS 镜像与 cpp 头文件的常量同构。不被 main 生产源反向依赖；测试文件保留自己的 L3 以便协议地图完整，但不计入生产交付边界。

## 成员清单

ContentRange.test.ets: 206 Content-Range 续传头解析回归
DownloadTaskParams.test.ets: 任务类型与默认字段回归
ErrorCodes.test.ets: 错误码属性/前缀契约与不双前缀回归
EventHub.test.ets: 事件监听、移除与 RNInstance 投影回归
InstallRecord.test.ets: 复用真实完成记录纯函数，回归序列化/staging、仅零字节来源历史兼容、非空 JSON {} 拒绝、缺 bundle 摘要构建 PATCH_FAILED 与激活 SWITCH_VERSION_FAILED；artifact 摘要仍可省略
List.test.ets: 测试发现/执行冒烟
ManifestParsing.test.ets: patch manifest copies/deletes/CRC 解析回归
Validation.test.ets: 路径、hash 和输入边界回归
check-constant-parity.js: 断言 cpp constexpr 头与 ArkTS export const 镜像逐值一致的纯 Node 守门
install_napi_host.cpp: Node NAPI 测试装载器，包含真实 install_napi.h/round_napi.h；仅宿主入口在兑现Promise、返回undefined及抛错边界同步调用JS，复现Ark重入，不复制注册表/安装规则，不进入HAR
verify-round-har.py: HAR双ABI ELF架构/17安装配置轮次注册/内部未解析引用和新执行器门禁；T27额外拒绝四个旧flow注册，输出SHA-256，不执行设备NAPI
test-install-napi.sh: 先执行真实共享核 131 检查，再以 PIC 编译宿主 addon；优先从当前 Node 安装发现 headers，支持 NODE_INCLUDE_DIR 指定，缺失时给出明确路径并失败，不生成 Harmony 发布库
CLAUDE.md: Harmony 测试隔离与覆盖范围地图

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

T11：InstallRecord 夹具改为真实 64 位摘要，manifest 的 null 来源按核心同路径规则；Hypium 未执行。src/__tests__/harmonyInstallRecord.test.ts 驱动真实 Node NAPI/共享核/文件 IO 与 ArkTS VM，不能替代 OpenHarmony ABI 或设备验证。新增文件职责登记于本地图，不新增代码注释。
