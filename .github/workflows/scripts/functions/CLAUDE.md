# functions/
> L2 | 父级: ../CLAUDE.md

Firebase Functions 测试工程。package/tsconfig 以 TypeScript 4.9、Node 16 类型边界独立构建，`src/` 暴露默认区域、指定区域和样本数据回显函数，供 CI 验证 SDK callable 行为；子工程必须隔离仓库根部的 Bun/Node 新版环境类型。

## 成员清单

src/: callable function 实现与测试样本
.gitignore: 排除 lib、typings 与 node_modules，保留 Bun 锁文件作为可复现依赖事实源
bun.lock: Bun 1.3 解析后的 functions 精确依赖图，阻断 Firebase 传递依赖漂移
package.json: Firebase Functions 运行依赖、Node 16 类型钉死与 build/serve 脚本
tsconfig.json: CommonJS/ES2017 严格编译目标，仅注入 Node 类型以隔离父级 workspace 声明

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
