/**
 * [INPUT]: 依赖 APK ZIP、Android manifest 二进制 XML、资源表与图标资源解析器
 * [OUTPUT]: 对外提供 ApkParser，提取 Android APK 的应用元数据
 * [POS]: 应用包解析子域的 APK 实现，复用 Zip、ManifestParser 与 ResourceFinder
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
