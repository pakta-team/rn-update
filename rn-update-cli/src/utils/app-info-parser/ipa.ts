/**
 * [INPUT]: 依赖 bplist-parser 的 binary plist 解码与 plist 包的延迟 CommonJS/ESM 加载
 * [OUTPUT]: 对外提供 parsePlist，解析 XML/BOM XML 或 binary Info.plist 并拒绝未知格式
 * [POS]: IPA 属性列表的纯解析边界；ZIP 条目和应用身份由 utils/index 汇总，不再承担图标解析
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
