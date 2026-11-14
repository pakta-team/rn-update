# scripts/
> L2 | 父级: ../CLAUDE.md

成员清单

build.js: Node 跨平台构建入口，清理 lib、调用项目 TypeScript 编译器并修正 CLI 入口可执行位，禁止依赖 Unix shell。
benchmark-diff-stream.ts: 大体积 ZIP/HBC 差分流基准，测量窗口差分与单流 patch 的资源边界。
fuzz-hermes-base.ts: 使用真实 hermesc 对 base/plain/delta 编译做差分模糊测试，@babel/parser 保证变异落在真实字符串字面量边界，failureFingerprint 去重现场并以 hermesFuzzSucceeded 裁决，保留误杀与漏报现场。
hermes-fuzz-literals.ts: 基于 @babel/parser 的字符串字面量边界扫描与 fuzzStringLiterals 变异原语，供模糊测试与其单测消费。
hermes-fuzz-result.ts: HermesFuzzSummary 汇总类型与 hermesFuzzSucceeded 终局裁决（planted 漏检、compileErrors 比例、空轮次判定），上报与回归测试共享。
prepublish.ts: Bun 发布前版本编排，根据显式版本或 Git tag 更新 package.json 并执行发布守门。
smoke-lib.js: Node 最低版本烟雾测试，加载 lib 模块并以显式测试兼容模式验证本地 `/api` 伪服务、代理和上传链路。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
