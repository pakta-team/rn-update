/**
 * [INPUT]: 依赖 compile-node-ts 导出的工程路径与制品准备入口
 * [OUTPUT]: 对外提供 Node CLI 转发并透传准备脚本退出码
 * [POS]: e2etest scripts 的稳定 JS 命令边界
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { buildRoot, compileNodeTs, projectRoot } = require('./compile-node-ts');
const compiledEntry = path.join(
  buildRoot,
  'scripts/prepare-local-update-artifacts.js'
);

function run(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    env: process.env,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

compileNodeTs();
run([compiledEntry]);
