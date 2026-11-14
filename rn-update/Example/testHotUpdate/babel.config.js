/**
 * [INPUT]: 依赖 React Native Babel preset 与生产环境 Paper 插件。
 * [OUTPUT]: 导出 Metro/Jest 共用的 Babel 转换配置。
 * [POS]: testHotUpdate 构建工具边界，决定 JSX/TS 与 Paper 生产代码如何编译。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
module.exports = {
  presets: ['module:@react-native/babel-preset'],
  env: {
    production: {
      plugins: ['react-native-paper/babel'],
    },
  },
};
