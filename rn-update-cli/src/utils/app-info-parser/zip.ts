/**
 * [INPUT]: 依赖文件路径、ZIP 条目枚举/读取与归档元数据辅助函数
 * [OUTPUT]: 对外提供 Zip 基类，统一平台应用包的条目访问和路径解析
 * [POS]: 应用包解析子域的共享归档边界，隐藏文件路径与 ZIP 流细节
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
