# entry/
> L2 | 父级: ../CLAUDE.md

HAP 模块边界。`hvigorfile.ts` 注册 Pakta plugin，`src/main` 负责应用运行时，`src/test` 与 `src/ohosTest` 分离本地单测和设备集成测。

## 成员清单

hvigorfile.ts: hapTasks 与仓库内 reactNativeUpdatePlugin 组合入口，避免通过未发布的 npm 包名解析
src/: HAP 主进程、单元测试与设备测试源码
build-profile.json5: entry 模块构建 profile，按 arm64-v8a 与 x86_64 双 ABI 编译 RNOH 原生运行时
oh-package.json5: entry 模块的 RNOH 与 Pakta HAR 依赖
oh-package-lock.json5: ohpm 生成的 entry 依赖锁定图（只读生成物）

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
