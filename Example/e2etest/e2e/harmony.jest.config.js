/**
 * [INPUT]: 依赖 Jest、Babel-Jest 与 Harmony 全局 hook 路径
 * [OUTPUT]: 对外提供 HarmonyOS e2e runner 配置对象
 * [POS]: e2e/harmony 测试的独立执行入口
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const path = require('node:path');

module.exports = {
  rootDir: '..',
  testMatch: ['<rootDir>/e2e/harmony/**/*.test.ts'],
  testTimeout: 300000,
  maxWorkers: 1,
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  transform: {
    '^.+\\.(js|jsx|ts|tsx)$': [
      'babel-jest',
      { configFile: path.resolve(__dirname, '../babel.config.js') },
    ],
  },
  globalSetup: '<rootDir>/e2e/harmony/globalSetup.js',
  globalTeardown: '<rootDir>/e2e/harmony/globalTeardown.js',
  testEnvironment: 'node',
  verbose: true,
};
