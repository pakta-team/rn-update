/**
 * [INPUT]: 依赖 Bun 测试进程的环境变量
 * [OUTPUT]: 将兼容性回归测试固定在旧路由兼容模式
 * [POS]: CLI 测试启动契约；生产代码没有旧服务开关，独立服务用例通过 RNU_SERVICE_URL 显式覆盖
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
if (process.env.PAKTA_TEST_COMPAT_ROUTES !== '1') {
  process.env.PAKTA_TEST_COMPAT_ROUTES = '1';
}
