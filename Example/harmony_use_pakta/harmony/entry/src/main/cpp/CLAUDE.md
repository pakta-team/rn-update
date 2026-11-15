# cpp/
> L2 | 父级: ../CLAUDE.md

RNOH 原生构建 glue。CMake 把生成代码、RNOH bridge 与 PaktaTurboModule 链入 `rnoh_app`，PackageProvider 负责运行时注册包。

## 成员清单

CMakeLists.txt: rnoh_app 编译、头文件路径与 PaktaTurboModule 源汇合
PackageProvider.cpp: 返回 PaktaPackage 的 RNOH PackageProvider 实现

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
