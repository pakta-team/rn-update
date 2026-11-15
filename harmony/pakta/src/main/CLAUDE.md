# main/
> L2 | 父级: ../CLAUDE.md

HarmonyOS 生产源集。ets 维护更新状态、下载和 RNOH JS 边界，cpp 连接共享 patch/update-flow 内核，module.json5 只描述宿主装载边界。

## 成员清单

cpp/: NAPI 状态/补丁/决策桥与 RNOH TurboModule C++ 注册
ets/: 更新上下文、下载事务、原生检查、bundle provider、Package 与 TurboModule
module.json5: 声明 pakta HAR 模块类型与设备范围
resources/: base/en_US/zh_CN 的 element/string.json 字符串资源，仅承载 npm 包模板文案，代码与 Manifest 均未引用
CLAUDE.md: HarmonyOS 生产源集的数据流与成员地图

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
