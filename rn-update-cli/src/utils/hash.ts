/**
 * [INPUT]: 依赖 node:crypto 与文件流
 * [OUTPUT]: 对外提供 sha256Hex 与流式 sha256File
 * [POS]: CLI 哈希原语层，供 bundle、Hermes base 缓存与上传去重计算内容指纹
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { createHash } from 'crypto';
import fs from 'fs';

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** sha256 of a file, streamed (a bundle or cached base can be tens of MB) */
export async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
