# com/awesomeproject/
> L2 | 父级: ../../CLAUDE.md

样例 Android 宿主包。`MainApplication` 是 SDK bundle 选择的唯一原生注入点，`MainActivity` 只承载 RN 页面。

## 成员清单

MainActivity.kt: 注册 AwesomeProject 根组件并启用 RN 默认 delegate
MainApplication.kt: 创建 ReactHost、加载 RN，并从 UpdateContext 取得当前 bundle URL

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
