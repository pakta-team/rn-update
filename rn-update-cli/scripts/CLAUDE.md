# scripts/
> L2 | 父级: ../CLAUDE.md

成员清单

build.js: Node 跨平台构建入口，清理 lib、调用项目 TypeScript 编译器并修正 CLI 入口可执行位，禁止依赖 Unix shell。
benchmark-diff-stream.ts: 大体积 ZIP/HBC 差分流基准，测量窗口差分与单流 patch 的资源边界。
fuzz-hermes-base.ts: 使用真实 hermesc 对 base/plain/delta 编译做差分模糊测试，@babel/parser 保证变异落在真实字符串字面量边界，failureFingerprint 去重现场并以 hermesFuzzSucceeded 裁决，保留误杀与漏报现场。
hermes-fuzz-literals.ts: 基于 @babel/parser 的字符串字面量边界扫描与 fuzzStringLiterals 变异原语，供模糊测试与其单测消费。
hermes-fuzz-result.ts: HermesFuzzSummary 汇总类型与 hermesFuzzSucceeded 终局裁决（planted 漏检、compileErrors 比例、空轮次判定），上报与回归测试共享。
prepublish.ts: Bun 发布前版本编排，校验显式版本或 Git tag 后写入 package.json；dry-run 仍更新本地版本，不执行 npm 发布。
verify-t24-local.sh: 仓库外隔离 Linux 复验入口，固定 Node24.11.1/18.17.0、Bun1.3.14 和四组 Hermes 编译器，核对 Metro 夹具与下载摘要，汇总回归/fuzz/lint/build/Node18 交付日志和退出码。
smoke-lib.js: Node 最低版本烟雾测试，加载 lib 模块、执行 ZIP 偏移回归，并以显式测试兼容模式验证本地 `/api` 伪服务、代理和上传链路。
test-zip-offset.js: 向真实 Node 文件流注入 WSL 隐式 writev 偏移丢失，验证 buffer/file 首条与 manifest 完整保留，由 smoke-lib.js 自动执行。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
