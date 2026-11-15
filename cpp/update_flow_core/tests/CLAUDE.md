# tests/
> L2 | 父级: ../CLAUDE.md

update_flow_core 的跨语言同构验证层。TypeScript 生成 canonical 输入/输出，C++ 可执行程序回放并额外以恶意 JSON 固定解析器安全边界。

## 成员清单

CLAUDE.md: update_flow_core 测试职责、成员与生成向量边界地图
flow_vectors.json: 由 scripts/generate-flow-vectors.ts 生成的 TS/C++ golden 契约，JSON 生成物不添加注释型 L3
fuzz_flow_json.cpp: libFuzzer harness，验证 Parse/Stringify 往返封闭与决策管线对任意服务端字节不崩溃（FUZZ=1 经 test-update-flow-core.sh）
update_flow_core_test.cpp: 分派并比较共享向量，覆盖 JSON 深度/格式攻击和 HandleCheckResponse 组合决策
config-equivalence-vectors.json: 冻结上游 62 个配置等价案例，正反两个方向回放
native-config-vectors.json: 冻结上游配置门禁与严格归一化案例；回放器仅替换默认服务身份并补默认 channel
native-round-vectors.json: 冻结上游请求准备、端点/发现查询、响应计划；请求期望显式适配本地默认 channel
round-engine-vectors.json: 冻结上游 35 条完整轮次、宿主取消与安全目录名向量；逐步对比命令和 JSON/Value API
pakta-flow-vectors.json: 本地显式期望，覆盖固定宿主 channel、opaque buildTime、bundleStatus、八请求预算、HTTPS 发现降级拒绝和五阶段取消/迟到事件
native_flow_test.cpp: 独立回放上述向量，以 DeepEquals 校验命令、以原文保留缓存身份；与旧 111 向量测试分开编译，不替换旧回归
config_host.cpp: 配置专项子进程宿主，链接生产共享核，按JSON操作分派normalize/gate/equivalent/cancel；不复制配置规则或平台IO

冻结四份 JSON 字节保持不变；测试侧 Adapt 只给请求及其嵌套缓存文本插入 channel:default，Normalize 的期望只替换默认服务和补 channel。Pakta 专项不套默认渠道适配，不从被测核心生成期望。完整证据和文件契约见 ../../../scripts/flow-map.md。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
