/**
 * [INPUT]: 依赖 Jest/Babel-Jest/Detox runner 与本地 global hooks
 * [OUTPUT]: 对外提供常规 Android/iOS Detox e2e runner 配置
 * [POS]: e2e 主套件的执行拓扑边界，排除 Harmony/native/smoke 的独立 runner，避免设备契约串入通用 Detox
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const path = require('node:path');

const moduleDir = __dirname;

/** @type {import('jest').Config} */
const config = {
  rootDir: '..',
  testMatch: ['<rootDir>/e2e/**/*.test.ts'],
  // ---------- 独立设备套件各自拥有平台环境和服务生命周期 ----------
  testPathIgnorePatterns: [
    '/e2e/harmony/',
    '/e2e/harmony-native/',
    '/e2e/smoke/',
    '/e2e/native/',
  ],
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
