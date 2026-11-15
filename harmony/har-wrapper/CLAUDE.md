# har-wrapper/
> L2 | 父级: ../CLAUDE.md

HarmonyOS 应用级 HAR 发布包装。它只描述应用身份、产品/模块映射和 Hvigor 入口，把真正的更新运行时留在 pakta HAR，不复制业务规则。

## 成员清单

AppScope/: HAR 包装应用级 bundleName、版本与厂商元数据
build-profile.json5: DevEco 产品、SDK、构建模式与 pakta 模块映射
hvigor/: Hvigor 工具版本与依赖配置
hvigorfile.ts: 应用构建任务入口，委托 @ohos/hvigor-ohos-plugin
oh-package.json5: 包装工程依赖与模型版本声明
.gitignore: 排除 HAR 构建输出与本地 DevEco 状态文件
CLAUDE.md: HAR 包装边界、发布拓扑与成员地图

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
