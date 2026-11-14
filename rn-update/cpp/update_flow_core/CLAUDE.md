# update_flow_core/
> L2 | 父级: ../CLAUDE.md

更新流纯决策内核。既有 `update_flow_core` 对照 `src/updateFlowCore.ts` 的 JavaScript 值语义与策略；新增原生轮次以冻结及 Pakta 向量为契约。Android JNI、Harmony NAPI 与 Apple Objective-C++ 均已消费共享配置与 StepRound，平台执行 IO，不反向侵入纯核。

## 成员清单

CLAUDE.md: update_flow_core 的职责边界、成员与 TS 参考实现约束地图
flow_json.cpp: 实现有序对象、undefined、JS truthiness/严格相等/结构等价、受限 JSON 解析与规范序列化
flow_json.h: 声明最小 JavaScript 兼容值模型、Parse/Stringify 与显式 ParseLimits；默认 1 MiB/65536 节点不变，T11 manifest 独立使用 16 MiB/80000 节点
tests/: 跨语言 golden 向量和宿主机回归测试，详见 tests/CLAUDE.md
native_config.h: pakta::updateflow 的配置门禁、归一化和等价接口；只返回值，不拥有配置存储
native_config.cpp: 配置门禁/等价/白名单及 URL 归一化的共享实现，默认 Pakta 服务；fixedHost=true 拒绝 config.channel，通用模式保留 channel 默认 default，显式 null 不等同缺省
native_round.h: 声明配置与宿主环境到请求、端点步进、响应计划的无 IO 边界
native_round.cpp: 复用旧 updateflow 决策，固定宿主 channel、opaque buildTime 和根 bundleStatus，缓存保留原始请求/配置；发现与端点共用八次预算
round_engine.h: 声明 JSON 状态/事件/命令与宿主取消检查；AndroidRound、HarmonyRound 与 RCTPaktaRoundEngine 执行命令并回传事件
round_engine.cpp: sans-IO 回放配置门禁、HTTP/下载预算、独立 full 窗口、激活意图与代际提交命令；cancel 后忽略迟到事件
update_flow_core.cpp: 实现灰度分桶、带 channel 的请求体、URL/端点、响应解析、下载尝试和 forceBoot 激活策略，并与 TypeScript 的不可变身份字段顺序保持一致
update_flow_core.h: 声明与 TypeScript 参考实现逐项同构的无 IO 决策接口

依赖方向：既有 `update_flow_core` 消费 `flow_json`，native_round 复用其策略及 HBC 能力常量，round_engine 组合 native_config/native_round。Android 仅由 android/jni/native_round_jni 适配配置与轮次；Harmony round_napi 和 Apple 片段同样只适配值、执行副作用并回传事件，核心不依赖平台。T27 删除无生产消费者的四入口旧 JNI 包装，不删除仍被 native_round 消费的共享策略。

T11 对 flow_json.cpp/h 的扩展仅注入调用方解析限额，默认 Parse(text, ok) 委托默认限额；不改变深度、序列化或 JS 值语义。文件级变更契约见 ../../scripts/install-map.md。

T13 配置/T14 纯核来自 b80885832b182330114326e540f3103df408463a，新增接口置于 pakta::updateflow，原有全局 updateflow/flowjson 保留。“不接平台”仅是迁入阶段历史：当前三端归一化器均委托 NormalizeConfiguration(..., true)，轮次均消费 StepRound；构建清单已有三个实现源。文件契约、历史验证和当前接线见 ../../scripts/flow-map.md；不据此宣称全端原生或设备验收完成，不迁存储。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
