/**
 * [INPUT]: 依赖 react-native Jest preset 与项目 Babel 配置。
 * [OUTPUT]: 导出 Harmony 消费端最小 Jest 配置，使用 RN preset 执行页面 smoke 测试。
 * [POS]: 普通 RN 单测工具边界，与 Harmony Hypium 设备测试分离。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
module.exports = {
  preset: 'react-native',
};
