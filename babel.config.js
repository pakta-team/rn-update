/**
 * [INPUT]: 依赖 React Native Babel 预设模块 `module:@react-native/babel-preset`
 * [OUTPUT]: 导出 Metro/Babel 使用的 presets 配置，将仓库源码转换为 React Native 可执行模块
 * [POS]: 仓库根构建入口，统一 JS/TS/TSX 转换约定；不承载应用业务逻辑
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
module.exports = {
  presets: ['module:@react-native/babel-preset'],
};
