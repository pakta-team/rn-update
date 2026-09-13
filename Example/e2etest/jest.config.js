/**
 * [INPUT]: 依赖 React Native Jest preset 与 jest.setup.js 环境替身
 * [OUTPUT]: 对外提供样例单元测试 runner 配置
 * [POS]: e2etest 根级 Jest 边界，端到端套件由 e2e/ 独立 runner 承担
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
module.exports = {
  preset: '@react-native/jest-preset',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testPathIgnorePatterns: ['/node_modules/', '/e2e/', '/\\.e2e-artifacts/'],
};
