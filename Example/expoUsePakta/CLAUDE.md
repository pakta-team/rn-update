# expoUsePakta/
> L2 | 父级: ../CLAUDE.md

Expo 57 消费端样例。它把 `rn-update` 的 Expo Modules 接入压缩成一个可手工操作的更新页面，并保留原生方法调试入口；样例只验证 SDK 边界，不向生产包反向提供能力。

## 成员清单

App.tsx: Expo 根页面与 PaktaProvider 装配，展示检查、下载、延迟/立即切换和当前 bundle 状态
TestConsole.js: 原生 PaktaModule 手工调用面板，把文本命令转换为测试方法与参数
index.js: Expo Router 启动入口，交给 `expo-router/entry` 建立应用运行时
app/: Expo Router 57 的文件路由入口，将根页面转交给 App.tsx
app.json: Expo 应用身份、平台包名、资源与插件声明；`rn-update` 插件以 `channel: staging` 固化渠道身份
package.json: Expo/RN 版本锁定与启动、检查脚本；rn-update 用本地 file 依赖确保样例始终验证当前 SDK 的 Expo 插件
update.json: Android 消费端 appKey 配置，供 App.tsx 创建 Pakta 客户端
tsconfig.json: Expo TypeScript 编译约束
biome.json: 样例静态检查配置

资源图片只作为页面展示输入，不在本地图中重复描述；`node_modules` 与锁文件属于依赖产物。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
