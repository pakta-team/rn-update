# main/
> L2 | 父级: ../CLAUDE.md

Android 公共生产源集。Manifest 声明构建身份与安全文件共享，java 承担更新状态和下载事务，res 仅开放 APK 安装所需的应用私有文件路径。

## 成员清单

CLAUDE.md: 公共源集的运行时组件、资源与代码边界地图
AndroidManifest.xml: 兼容旧 AGP 的带 package Manifest，注册构建时间与非导出 PaktaFileProvider
AndroidManifestNew.xml: 支持 namespace 的新 AGP Manifest，注册与旧版本相同的运行时组件
java/: 共享更新核心、React Native 桥公共实现与 Expo Modules 适配
res/: FileProvider 路径等 Android 资源契约

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
