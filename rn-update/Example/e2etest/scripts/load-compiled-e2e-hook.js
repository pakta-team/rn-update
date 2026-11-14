/**
 * [INPUT]: 依赖 compile-node-ts 的编译结果与目标 hook 相对路径
 * [OUTPUT]: 对外提供加载并转发 TS global hook 的工厂函数
 * [POS]: e2e/globalSetup.js 与 globalTeardown.js 的 Node 兼容桥
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const path = require('node:path');

const { buildRoot, compileNodeTs } = require('./compile-node-ts');

module.exports = function loadCompiledE2EHook(relativeEntry) {
  compileNodeTs();
  return require(path.join(buildRoot, relativeEntry));
};
