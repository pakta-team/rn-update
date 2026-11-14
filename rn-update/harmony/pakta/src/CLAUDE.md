# src/
> L2 | 父级: ../CLAUDE.md

pakta 源树。main 是交付运行时，test 只验证协议和纯工具；跨层依赖由 main/CLAUDE.md 继续展开。

## 成员清单

main/: ArkTS/ETS 运行时、NAPI/C++ 桥与模块 Manifest
test/: Harmony 单元回归，验证任务参数、事件、Manifest 与输入校验，不成为生产依赖
CLAUDE.md: pakta 源树的运行时/测试边界地图

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
