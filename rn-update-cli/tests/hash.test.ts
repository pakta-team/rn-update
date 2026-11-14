/**
 * [INPUT]: 依赖 hash 的内存/流式 SHA-256、node:fs 临时文件与 Bun 测试断言
 * [OUTPUT]: 验证空文件、二进制多分块与缺失文件的 SHA-256 内容身份及错误传播
 * [POS]: CLI 内容指纹原语回归防线，保证文件流迁移不改变制品去重协议
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { sha256File, sha256Hex } from '../src/utils/hash';

describe('sha256File', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rnu-hash-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('preserves the standard empty-file digest', async () => {
    const file = path.join(dir, 'empty.ppk');
    fs.writeFileSync(file, '');
    expect(await sha256File(file)).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  test('matches the in-memory digest across multiple binary chunks', async () => {
    const file = path.join(dir, 'binary.ppk');
    const bytes = Buffer.alloc(1024 * 1024 + 31);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
    fs.writeFileSync(file, bytes);
    expect(await sha256File(file)).toBe(sha256Hex(bytes));
  });

  test('propagates missing-file errors', async () => {
    await expect(
      sha256File(path.join(dir, 'missing.ppk')),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
