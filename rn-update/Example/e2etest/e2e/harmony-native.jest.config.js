/**
 * [INPUT]: 依赖已有 Harmony 单设备配置与独立 native 套件
 * [OUTPUT]: 提供不混入原九项的原生 forceBoot/失败 JS Jest 入口
 * [POS]: e2e 的独立原生验收 runner，共用服务生命周期而隔离用例与结果
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
module.exports = {
  ...require('./harmony.jest.config'),
  testMatch: ['<rootDir>/e2e/harmony-native/native-check.test.ts'],
};
