/**
 * [INPUT]: 依赖 Bun 测试、文件系统与声明构建子进程，不导入客户端或原生桥运行时
 * [OUTPUT]: 锁定类型/运行入口分离、Codegen 源目录、声明构建清理与重复编译确定性
 * [POS]: __tests__ 的 T10 发布契约回归；真实 tarball 解包消费由 test:pack 单独执行
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '../..');
const output = path.join(root, 'dist/types');

function build() {
  execFileSync('node', ['scripts/build-types.js'], { cwd: root });
  return readdirSync(output, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.d.ts'))
    .sort()
    .map((file) => [file, readFileSync(path.join(output, file), 'utf8')]);
}

test('声明编译确定且清理旧产物，运行与 Codegen 继续消费 src', () => {
  const metadata = JSON.parse(
    readFileSync(path.join(root, 'package.json'), 'utf8')
  );
  expect(metadata.types).toBe('dist/types/index.d.ts');
  expect(metadata.main).toBe('src/index');
  expect(metadata.codegenConfig.jsSrcsDir).toBe('src');
  expect(metadata.scripts.prepack).toContain('bun run build:types');
  const first = build();
  expect(first.some(([file]) => file === 'index.d.ts')).toBe(true);
  expect(first.some(([file]) => file?.includes('__tests__'))).toBe(false);
  writeFileSync(
    path.join(output, 'stale.d.ts'),
    'export declare const stale: 1;'
  );
  expect(build()).toEqual(first);
  expect(readdirSync(output)).not.toContain('stale.d.ts');
}, 30_000);
