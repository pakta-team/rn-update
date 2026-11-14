/**
 * [INPUT]: 依赖 React Native CLI 的依赖覆盖约定与仓库根 rn-update 源码
 * [OUTPUT]: 对外提供本地 SDK 的 Android/iOS/Harmony 原生根路径覆盖
 * [POS]: e2etest 消费端链接边界；包管理器版本仅提供依赖名，真正构建源固定到当前工作树
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const path = require('node:path');

module.exports = {
  dependencies: {
    'rn-update': {
      root: path.resolve(__dirname, '../..'),
    },
  },
};
