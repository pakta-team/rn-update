/**
 * [INPUT]: 依赖 Jest/Babel-Jest/Detox runner 与本地 global hooks
 * [OUTPUT]: 对外提供常规 Android/iOS Detox e2e runner 配置
 * [POS]: e2e 主套件的执行拓扑边界，排除独立平台 runner
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const path = require('node:path');

const moduleDir = __dirname;

/** @type {import('jest').Config} */
const config = {
  rootDir: '..',
  testMatch: ['<rootDir>/e2e/**/*.test.ts'],
  // Harmony tests use their own runner (harmony.jest.config.js), not Detox.
  // The debug boot smoke has its own runner config too (smoke/jest.config.js).
  // The native cold-start suite (native/jest.config.js) runs as its own CI job:
  // it costs several app launches, and the iOS job's budget has no room left.
  testPathIgnorePatterns: ['/e2e/harmony/', '/e2e/smoke/', '/e2e/native/'],
  testTimeout: 300000,
  maxWorkers: 1,
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  transform: {
    '^.+\\.(js|jsx|ts|tsx)$': [
      'babel-jest',
      { configFile: path.resolve(moduleDir, '../babel.config.js') },
    ],
  },
  globalSetup: '<rootDir>/e2e/globalSetup.js',
  globalTeardown: '<rootDir>/e2e/globalTeardown.js',
  reporters: ['detox/runners/jest/reporter'],
  testEnvironment: 'detox/runners/jest/testEnvironment',
  verbose: true,
};

module.exports = config;
