/**
 * [INPUT]: 依赖 TypeScript 编译器、Node child_process 与 e2e TS hook 路径
 * [OUTPUT]: 对外提供 buildRoot/compileNodeTs 等临时编译入口
 * [POS]: e2etest hook 运行时桥，将 TS 脚本转换为 Node 可加载产物
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const buildRoot = path.join(projectRoot, '.e2e-artifacts/.ts-build');
const tscCli = path.join(projectRoot, 'node_modules/typescript/bin/tsc');
const tsConfigPath = path.join(projectRoot, 'tsconfig.node.json');

function compileNodeTs() {
  const result = spawnSync(
    process.execPath,
    [tscCli, '-p', tsConfigPath, '--outDir', buildRoot],
    {
      cwd: projectRoot,
      stdio: 'inherit',
      env: process.env,
    }
  );

  if (result.status !== 0) {
    throw new Error(
      `Failed to compile Node-side TS files, exit code: ${result.status}`
    );
  }

  return buildRoot;
}

module.exports = {
  buildRoot,
  compileNodeTs,
  projectRoot,
  tsConfigPath,
};

if (require.main === module) {
  compileNodeTs();
}
