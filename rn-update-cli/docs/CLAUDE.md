# docs/
> L2 | 父级: ../CLAUDE.md

CLI 的语义相文档，记录 Hermes base 等价校验的边界、数据流、已知风险与现场排查方式；文档只描述已落地的机器相，不承载独立实现。

成员清单

hermes-base-verification.md: Hermes base 二进制字面量/逐函数等价校验的覆盖范围、v87–96/v98/v99 布局差异、DefineOwnById* 字符串操作数折叠理由、detail 脱敏与 hermesBaseFingerprint 分组指纹、模糊测试结论与拒绝排查步骤。

法则: 先以代码行为为事实源，再记录设计边界；[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
