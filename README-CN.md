# rn-update · React Native 热更新 SDK

![Pakta SDK — check, download, activate](./readme-banner.svg)

[![npm version](https://img.shields.io/npm/v/rn-update?style=flat-square&color=E65D24)](https://www.npmjs.com/package/rn-update)
[![License: MIT](https://img.shields.io/badge/license-MIT-E65D24?style=flat-square)](./LICENSE)
[![Android · iOS · HarmonyOS](https://img.shields.io/badge/platforms-Android%20%7C%20iOS%20%7C%20HarmonyOS-211D18?style=flat-square)](#platforms)

### 让每一次修复，更快抵达用户。

面向 **React Native、Expo、HarmonyOS** 的 **OTA 热更新 SDK**。更新 JavaScript 与资源，支持差分下载、灰度投放与崩溃回滚。

[English](./README.md) · [Pakta](https://pakta.site/zh-CN/) · [快速开始](#quick-start) · [代码集成文档](https://pakta.site/zh-CN/docs/integration/) · [CLI](https://github.com/pakta-team/rn-update-cli/blob/main/README.zh-CN.md) · [价格](https://pakta.site/zh-CN/pricing/)

---

## 更新体验，由你掌控

| 能力 | 为 App 带来什么 |
| --- | --- |
| **差分下载** | 通过补丁减少重复传输，实际收益取决于构建内容 |
| **灰度投放** | 配合服务端按渠道、原生版本与比例发布 |
| **更新策略** | 静默下载、稍后生效，或提示用户后更新 |
| **崩溃恢复** | 健康确认、崩溃回滚与原生冷启动修复通道 |
| **可观测性** | 更新状态、下载进度与 Sentry / Crashlytics 关联 |

<a id="quick-start"></a>

## 快速开始

### 1. 安装并接入原生工程

```bash
npm install rn-update
```

iOS 还需在 `ios` 目录运行 `pod install`。按下方示例配置 **bundle 加载入口与构建元数据**，然后重新构建 App。

<a id="platforms"></a>

| 平台 | 接入示例 |
| --- | --- |
| Android / iOS | [React Native](./Example/testHotUpdate) |
| Expo | [Development / production build](./Example/expoUsePakta) |
| HarmonyOS | [RNOH](./Example/harmony_use_pakta) |

> Expo 需要包含本原生模块的开发或正式构建，Expo Go 不支持。修改原生代码或依赖后，需要分发新的原生包。

Expo 应用还可以声明 config plugin，把分发渠道固化进原生包：

```json
{
  "expo": {
    "plugins": [["rn-update", { "channel": "staging" }]]
  }
}
```

`channel` 是该插件写入原生工程的唯一值——`appKey` 与服务端地址仍留在 JS 客户端，保证配置单一真相源。不填 `channel` 则使用默认渠道。

### 2. 在根组件连接 Pakta

从控制台获取对应平台的 `appKey`，在组件外创建客户端：

```tsx
import { Pakta, PaktaProvider } from 'rn-update';
import App from './App';

const client = new Pakta({
  appKey: 'YOUR_PLATFORM_APP_KEY',
  updateStrategy: 'silentAndLater',
});

export default function Root() {
  return (
    <PaktaProvider client={client}>
      <App />
    </PaktaProvider>
  );
}
```

默认连接 `https://pakta.yoghourt.space/api`，在启动与回到前台时检查更新。App 只使用公开 `appKey`，个人访问令牌留在 CLI / CI。

### 3. 发布第一条更新

完成原生接入 → 安装 Release 构建 → 用 CLI 登记原生包 → 打包并灰度发布。

**[→ 跟随 CLI 发布指南](https://github.com/pakta-team/rn-update-cli/blob/main/README.zh-CN.md#quick-start)**

在设备上验证下载、生效与健康确认后，再扩大投放比例。渠道身份来自原生包元数据。

## 更新策略

| 配置 | 行为 |
| --- | --- |
| `updateStrategy: 'silentAndLater'` | 静默下载，后续启动生效 |
| `updateStrategy: 'silentAndNow'` | 下载完成后立即切换，可能中断当前操作 |
| `updateStrategy: 'alertUpdateAndIgnoreError'` | 提示更新，忽略检查错误；生产默认策略 |
| `updateStrategy: 'alwaysAlert'` | 显示更新及错误提示 |
| `checkStrategy: 'both'` | 启动与回到前台时检查；默认值 |
| `checkStrategy: null` | 关闭 JS 自动检查；原生冷启动检查仍可下载，常规流程不自动激活 |

更多选项以导出的 [`ClientOptions`](./src/type.ts) 为准，包括检查/下载/重启钩子、重试、语言及日志。运行中通过 `client.setOptions(...)` 更新配置。`useUpdate()` 读取更新状态与操作，`useUpdateProgress()` 单独订阅下载进度。

## 进阶配置

<details>
<summary><strong>健康确认、崩溃回滚与错误追踪</strong></summary>

- Provider 默认在 1000 ms 后自动确认更新成功。关键初始化较晚时，配置 `autoMarkSuccessDelayMs` 和 `healthCheck`；返回 `false` 会保留崩溃保护。
- 原生冷启动检查可在 JavaScript 无法正常启动时获取修复版本。`disableNativeCheck: true` 会关闭该恢复通道。恢复仍依赖网络、有效配置和可用修复版本。
- `getUpdateMetadata()`、`attachToSentry()` 和 `attachToCrashlytics()` 将更新身份关联到崩溃报告。`client.captureException()` 支持手动报告 JS 错误。
- `disableTelemetry` 关闭遥测及 JS 错误传输；`disableErrorReporting` 单独关闭 JS 错误传输。不要在错误上下文里写入令牌或个人信息。

</details>

<details>
<summary><strong>连接自己的服务</strong></summary>

切换部署时显式配置服务及端点发现地址：

```tsx
const client = new Pakta({
  appKey: 'YOUR_PLATFORM_APP_KEY',
  server: {
    main: ['https://YOUR_HOST/api'],
    queryUrls: ['https://YOUR_CDN/endpoints.json'],
  },
  updateStrategy: 'silentAndLater',
});
```

`queryUrls` 应提供与你的部署一致的端点清单。默认清单见 [`endpoints.json`](https://cdn.jsdelivr.net/gh/pakta-team/rn-update@main/endpoints.json)；维护默认服务时，仓库根目录与 SDK 内的该文件必须同步。

</details>

<details>
<summary><strong>React Native 版本兼容性</strong></summary>

包声明 React ≥16.8、React Native ≥0.59；这不是所有版本与架构组合的测试保证。请使用自己的 Release 构建验证目标平台、新旧架构与 RN 版本。

</details>

## 文档与许可

- [原生检查与激活协议](./NATIVE_CHECKUPDATE_DESIGN.md)
- [公开 API 出口](./src/index.ts)
- [许可证：MIT](./LICENSE)

Copyright (c) 2026 Yoghourt Technology(BeiJing) Company Limited.
