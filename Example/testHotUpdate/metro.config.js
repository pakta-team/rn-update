/**
 * [INPUT]: 依赖 RN Metro 默认配置与 Sentry 的 Metro 包装器。
 * [OUTPUT]: 导出 testHotUpdate 的 Metro 配置，保留默认 resolver 并注入 Sentry 处理。
 * [POS]: JavaScript 打包边界，被 CLI 与本地 start-rn 脚本共同消费。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const { withSentryConfig } = require('@sentry/react-native/metro');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {};

module.exports = withSentryConfig(
  mergeConfig(getDefaultConfig(__dirname), config)
);
