#!/usr/bin/env node
/**
 * [INPUT]: 依赖 Node fs/child_process、项目 TypeScript 编译器与 tsconfig.build.json
 * [OUTPUT]: 对外提供跨 Windows/macOS/Linux 的 CLI lib 清理、编译和可执行位修正流程
 * [POS]: scripts 构建入口，替代 package.json 中依赖 Unix rm/chmod 的脆弱 shell 串
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const libDir = path.join(projectRoot, 'lib');
const typescriptRoot = path.resolve(
  path.dirname(require.resolve('typescript')),
  '..',
);
const tscEntry = path.join(typescriptRoot, 'bin', 'tsc');

fs.rmSync(libDir, { recursive: true, force: true });

const compile = spawnSync(
  process.execPath,
  [tscEntry, '-p', path.join(projectRoot, 'tsconfig.build.json')],
  { cwd: projectRoot, stdio: 'inherit' },
);

if (compile.error) throw compile.error;
if (compile.status !== 0) process.exit(compile.status ?? 1);

for (const entry of ['bin.js']) {
  fs.chmodSync(path.join(libDir, entry), 0o755);
}
