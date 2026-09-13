/**
 * [INPUT]: 依赖 React Native Babel preset
 * [OUTPUT]: 对外提供 e2etest JavaScript/TypeScript 转译配置
 * [POS]: 样例构建与 Jest/Babel-Jest 共用的编译入口
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
module.exports = {
  presets: ['module:@react-native/babel-preset'],
};
