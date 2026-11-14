# fixtures/
> L2 | 父级: ../CLAUDE.md

隔离测试夹具目录，模拟 Hermes 进程的取消、超时、spawn 失败与晚到异步错误；不承载生产逻辑，也不参与 npm 包发布。

成员清单

hermes-async-check.cjs: 在 Node/Bun 独立进程中调用实际 Hermes API，并持续观察 unhandled rejection、uncaught exception 与结果标记

法则: 夹具必须可独立退出、不得依赖网络或用户配置；[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
