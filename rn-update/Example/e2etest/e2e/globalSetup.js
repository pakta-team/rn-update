/**
 * [INPUT]: 依赖 load-compiled-e2e-hook 的 TS 编译/加载能力
 * [OUTPUT]: 对外提供 Detox 可调用的 globalSetup 转发函数
 * [POS]: e2etest runner 的 JavaScript 兼容壳，不承载准备逻辑
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
module.exports = require('../scripts/load-compiled-e2e-hook')(
  'e2e/globalSetup.js'
).default;
