#!/usr/bin/env node
/**
 * [INPUT]: 依赖 TypeScript 包的 tsc 入口与 SDK tsconfig.build.json，不改写运行源码或原生产物
 * [OUTPUT]: 清理旧声明并编译 dist/types，编译失败时不保留半成品
 * [POS]: scripts 的声明构建入口，由 prepack 与独立 packlist 检查共同调用
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const { execFileSync } = require('node:child_process');
const { rmSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist/types');
const compilerPackage = require.resolve('typescript/package.json');
const compiler = path.resolve(
  path.dirname(compilerPackage),
  require(compilerPackage).bin.tsc
);

rmSync(output, { recursive: true, force: true });
try {
  execFileSync(process.execPath, [compiler, '-p', 'tsconfig.build.json'], {
    cwd: root,
    stdio: 'inherit',
  });
} catch (error) {
  rmSync(output, { recursive: true, force: true });
  throw error;
}
