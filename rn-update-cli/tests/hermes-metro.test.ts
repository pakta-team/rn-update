/**
 * [INPUT]: 依赖固定 SHA256 的 Metro bundle fixture、Hermes 编译器与语义审计器
 * [OUTPUT]: 验证真实大体积 Metro HBC 的零长度函数与 base/plain 等价性
 * [POS]: CLI Hermes 集成回归，仅在显式提供 fixture 目录时运行，不产生网络副作用
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { removeSync } from '../src/utils/fs-helpers';
import { compareHermesBytecode } from '../src/utils/hermes-base';
import { readHermesSemanticData } from '../src/utils/hermes-raw';

// CI explicitly supplies the pinned, hash-checked real Metro fixture directory.
// Offline unit runs do not download application bundles as a side effect.
const fixtures = process.env.HERMES_METRO_FIXTURES;
const hermesc = process.env.HERMESC;
const sources = {
  'base.jsbundle':
    '11c8ad8f7e8c7c59ee45582c77d896a35fa646617f3ba0f5b338a425a7c93b7d',
  's3-medium-feature.jsbundle':
    'a693e68254b6c13fae8f839d20c14f9d11c5ab98d4be1b8d13ba1e929a12d752',
};

describe.if(Boolean(fixtures))('real Metro bundle verification', () => {
  let dir: string;
  let plain: string;
  let delta: string;
  beforeAll(() => {
    // Missing compiler/fixture is a failure once the integration job opts in.
    expect(hermesc && fs.existsSync(hermesc)).toBe(true);
    for (const [name, hash] of Object.entries(sources)) {
      const bytes = fs.readFileSync(path.join(fixtures!, name));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(hash);
    }
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-metro-'));
    const compile = (source: string, name: string, base?: string) => {
      const out = path.join(dir, name);
      const result = spawnSync(
        hermesc!,
        [
          '-emit-binary',
          '-O',
          '-w',
          '-output-source-map',
          '-out',
          out,
          path.join(fixtures!, source),
          ...(base ? [`-base-bytecode=${base}`] : []),
        ],
        { encoding: 'utf8', timeout: 30_000 },
      );
      expect(result.error, result.stderr).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      return out;
    };
    const base = compile('base.jsbundle', 'base.hbc');
    plain = compile('s3-medium-feature.jsbundle', 'plain.hbc');
    delta = compile('s3-medium-feature.jsbundle', 'delta.hbc', base);
  }, 120_000);
  afterAll(() => {
    if (dir) removeSync(dir);
  });

  test('self-comparison includes legal zero-byte Static Hermes functions', async () => {
    const data = await readHermesSemanticData(plain);
    expect(data.functions.length).toBeGreaterThan(10_000);
    if (data.version === 98) {
      // This assertion prevents an unrelated small fixture from replacing the
      // production-shaped regression that exposed the empty-function bug.
      expect(
        data.functions.filter((fn) => fn.size === 0).length,
      ).toBeGreaterThan(0);
    }
    const result = await compareHermesBytecode(hermesc!, plain, plain);
    expect(result.status, result.detail).toBe('equivalent');
    expect(result.functions).toBe(data.functions.length);
    console.log(
      `Metro HBC ${data.version}: ${data.functions.length} functions, ${data.functions.filter((fn) => fn.size === 0).length} empty`,
    );
  }, 60_000);

  test('a real base/plain release pair remains equivalent', async () => {
    const result = await compareHermesBytecode(hermesc!, delta, plain);
    expect(result.status, result.detail).toBe('equivalent');
    expect(result.functions).toBeGreaterThan(10_000);
  }, 60_000);
});
