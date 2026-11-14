/**
 * [INPUT]: 依赖 parseBinaryXml 节点树与 ResourceFinder 的 resources.arsc 引用解析
 * [OUTPUT]: 对外提供 ApkManifestInfo 与 parseApkManifest，读取版本和 application 直接子级的 meta-data
 * [POS]: APK manifest 的纯解析边界；ZIP 与业务身份汇总由 utils/index 管理，未解析资源引用保持 undefined
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { ResourceFinder } from './resource-finder';
import { parseBinaryXml, type XmlElement } from './xml-parser/binary';

export interface ApkManifestInfo {
  versionName?: unknown;
  /** `<application>`'s `<meta-data>` entries, resource references resolved */
  metaData: Array<{ name?: unknown; value?: unknown }>;
}

/**
 * The fields of a binary AndroidManifest.xml the CLI reads, with
 * `@<resource>` references resolved through resources.arsc when given.
 */
export function parseApkManifest(
  manifest: Buffer,
  resources?: Buffer,
): ApkManifestInfo {
  let root: XmlElement;
  try {
    root = parseBinaryXml(manifest);
  } catch (e: any) {
    throw new Error(`Parse AndroidManifest.xml error: ${e.message || e}`);
  }
  let resourceMap: Record<string, unknown> = {};
  if (resources) {
    try {
      resourceMap = new ResourceFinder().processResourceTable(resources);
    } catch (e: any) {
      throw new Error(`Parser resources.arsc error: ${e}`);
    }
  }
  const resolve = (value: unknown) =>
    typeof value === 'string' && value.startsWith('resourceId:')
      ? resourceMap[`@${value.replace('resourceId:0x', '').toUpperCase()}`]
      : value;

  const application = root.children.find((el) => el.name === 'application');
  return {
    versionName: resolve(root.attributes.versionName),
    metaData: (application?.children ?? [])
      .filter((el) => el.name === 'meta-data')
      .map(({ attributes }) => ({
        name: resolve(attributes.name),
        value: resolve(attributes.value),
      })),
  };
}
