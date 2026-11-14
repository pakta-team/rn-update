/**
 * [INPUT]: 依赖 bplist/cgbi 解码、IPA ZIP、图标资源和平台元数据解析工具
 * [OUTPUT]: 对外提供 IpaParser，提取 iOS 应用的版本、标识和图标信息
 * [POS]: 应用包解析子域的 IPA 实现，兼容压缩 PNG 与 binary plist 变体
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

const parseBplist = require('bplist-parser').parseBuffer;

type ParsePlist = (content: string) => Record<string, any>;

let parsePlistPromise: Promise<ParsePlist> | undefined;

function loadParsePlist(): Promise<ParsePlist> {
  if (!parsePlistPromise) {
    parsePlistPromise = Promise.resolve().then(async () => {
      try {
        return require('plist').parse as ParsePlist;
      } catch (requireError) {
        const importModule = new Function(
          'specifier',
          'return import(specifier)',
        ) as (specifier: string) => Promise<{
          parse?: ParsePlist;
          default?: { parse?: ParsePlist };
        }>;
        const plistModule = await importModule('plist');
        const parsePlist = plistModule.parse ?? plistModule.default?.parse;
        if (!parsePlist) {
          throw requireError;
        }
        return parsePlist;
      }
    });
  }
  return parsePlistPromise;
}

/** Parse an Info.plist in XML or binary form. */
export async function parsePlist(buffer: Buffer): Promise<Record<string, any>> {
  const bufferType = buffer[0];
  if (bufferType === 60 || bufferType === 239) {
    return (await loadParsePlist())(buffer.toString());
  }
  if (bufferType === 98) {
    return parseBplist(buffer)[0];
  }
  throw new Error('Unknown plist buffer type.');
}
