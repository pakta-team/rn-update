# src/
> L2 | 父级: ../CLAUDE.md

HAP 源码分层。主进程把 RNOH 与 Pakta 接入 ArkUI，test 只运行本地逻辑，ohosTest 通过 abilityDelegator 验证设备文件与偏好存储。

## 成员清单

main/: ArkTS 页面、RNOH PackageFactory 与 C++ PackageProvider
test/: Hypium 本地单元测试
ohosTest/: 设备端 Hypium 集成测试
mock/: 开发预览器 mock 配置

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
