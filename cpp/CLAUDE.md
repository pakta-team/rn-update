# cpp/
> L2 | 父级: ../CLAUDE.md

跨平台原生核心，不依赖 React UI。`patch_core` 对字节与归档执行可验证变换，`update_flow_core` 对更新协议作纯决策；平台桥只能提供 IO 和生命周期，不得各自重写算法语义。

## 成员清单

patch_core/: 归档补丁、摘要校验、Hermes HBC 变换及 wire 格式、状态机、统一错误码与 Android/JNI 胶水；局部成员由 `patch_core/CLAUDE.md` 展开
T11 安装核现已由 Android JNI、Harmony NAPI 和 Apple Objective-C++ 调用，覆盖安装记录/Seal/Promote/Activation、manifest 解析和归档累计；状态锁、代际复核及目标清理仍归平台。flow_json 提供显式解析限额，旧调用默认上限保持不变；细节见 ../scripts/install-map.md。
update_flow_core/: JSON 轻量解析、检查结果与下载/激活决策，以及三端已接入的共享配置门禁/归一化与 sans-IO 轮次；Android JNI、Harmony NAPI 和 Apple 命令循环只适配边界，局部成员由 `update_flow_core/CLAUDE.md` 展开
CLAUDE.md: 共享 C++ 核心的模块边界、协作关系与协议约束地图

依赖方向：`update_flow_core` 选择策略，`patch_core` 执行具体变换；Android/iOS/Harmony 负责文件与网络边界。任何协议字段或错误码变化都必须同步 JS 类型、原生桥和共享测试向量。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
