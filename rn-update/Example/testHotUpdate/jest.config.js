/**
 * [INPUT]: 依赖 @react-native/jest-preset 与 jest.setup.js 环境初始化。
 * [OUTPUT]: 导出消费端单测入口、预设和路径过滤规则。
 * [POS]: testHotUpdate 的测试构建配置，隔离 node_modules 与未纳入本样例的 e2e。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
module.exports = {
  preset: '@react-native/jest-preset',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testPathIgnorePatterns: ['/node_modules/', '/e2e/'],
};
