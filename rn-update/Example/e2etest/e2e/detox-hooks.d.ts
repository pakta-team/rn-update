/**
 * [INPUT]: 依赖 Detox Jest runner 的 globalSetup/globalTeardown 模块形状
 * [OUTPUT]: 对 TypeScript 提供两个 Detox 全局 hook 的环境声明
 * [POS]: e2etest 编译期边界，避免测试入口为第三方 runner 增加类型依赖
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
declare module 'detox/runners/jest/globalSetup.js' {
  const detoxGlobalSetup: () => Promise<void>;
  export default detoxGlobalSetup;
}

declare module 'detox/runners/jest/globalTeardown.js' {
  const detoxGlobalTeardown: () => Promise<void>;
  export default detoxGlobalTeardown;
}
