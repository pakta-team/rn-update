/**
 * [INPUT]: 依赖 zip-entries 的有序枚举、嵌套 HAP 读取和条目 Buffer 提取
 * [OUTPUT]: 对外提供 readZipEntries，以单次扫描按正则位置返回原生包所需条目
 * [POS]: 三端原生包解析共享的只读 ZIP 边界；兼容条目大小写与 NUL 尾填充，不决定业务字段
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { enumZipEntries, readEntry } from '../zip-entries';

/**
 * Read the entries matching each pattern in a single pass over the archive
 * (nested .hap archives included). Each entry name is tried as-is and
 * lowercased, with NUL padding stripped. Returns buffers in pattern order.
 */
export async function readZipEntries(
  file: string,
  patterns: RegExp[],
): Promise<(Buffer | undefined)[]> {
  const results: (Buffer | undefined)[] = new Array(patterns.length);
  await enumZipEntries(file, async (entry, zipFile) => {
    if (entry.fileName.endsWith('/')) {
      return;
    }
    // biome-ignore lint/suspicious/noControlCharactersInRegex: strips NUL padding from entry names
    const name = entry.fileName.replace(/\u0000/g, '');
    const lowerName = name.toLowerCase();
    const index = patterns.findIndex(
      (pattern) => pattern.test(name) || pattern.test(lowerName),
    );
    if (index !== -1) {
      results[index] = await readEntry(entry, zipFile);
    }
  });
  return results;
}
