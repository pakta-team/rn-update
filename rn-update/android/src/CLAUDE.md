# src/
> L2 | 父级: ../CLAUDE.md

Android 源集选择层。main 保存所有架构共享实现，newarch/oldarch 只把同一 UpdateModuleImpl 暴露给不同 React Native 桥，禁止复制更新规则。

## 成员清单

CLAUDE.md: Android 源集依赖方向与成员地图
main/: Manifest、资源、共享 Java 更新核心与 Expo 适配
newarch/: React Native Codegen/TurboModule 薄适配源集
oldarch/: ReactContextBaseJavaModule 薄适配源集
test/: 不加载 so 与 Android 运行时的 JVM 单元测试源集

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
