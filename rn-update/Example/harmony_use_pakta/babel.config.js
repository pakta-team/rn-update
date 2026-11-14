/**
 * [INPUT]: 依赖 metro-react-native-babel-preset 与 RN 0.72 的 JavaScript 语法约束。
 * [OUTPUT]: 导出 Harmony 消费端 Metro/Jest 共用的 Babel preset 配置。
 * [POS]: harmony_use_pakta JavaScript 编译边界，保持普通 RN 与 RNOH bundle 语法一致。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
module.exports = {
  presets: ['module:metro-react-native-babel-preset'],
};
