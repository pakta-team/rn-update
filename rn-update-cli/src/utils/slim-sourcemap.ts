/**
 * [INPUT]: 依赖 Node path/zlib 与 source map JSON，接收构建机项目根和待归档 map
 * [OUTPUT]: 对外提供 source map 瘦身、gzip 归档与兼容解包函数
 * [POS]: CLI source map 归档边界，清除机器绝对路径与依赖源码内容但保留符号定位
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import path from 'path';
import zlib from 'zlib';

interface SourceMapV3 {
  sources?: unknown;
  sourcesContent?: unknown;
  sections?: unknown;
  [key: string]: unknown;
}

/**
 * Shrink a source map before archiving it with a version, without losing the
 * ability to locate any frame:
 *
 * - absolute source paths under the project root become relative (build
 *   machine paths do not belong in an uploaded artifact);
 * - `sourcesContent` of node_modules sources is dropped. Mappings and the
 *   source paths stay, so frames inside dependencies still symbolicate to
 *   `node_modules/...:line:column` — only the inline code snippet for those
 *   frames is lost, and dependency sources are recoverable from the lockfile
 *   anyway. On an RN app this is the bulk of the map's bytes.
 *
 * Returns null when the content is not a usable plain source map (invalid
 * JSON, or an indexed map with `sections`); the caller then uploads the
 * original file untouched.
 */
export function slimSourceMap(
  content: string,
  projectRoot: string,
): string | null {
  let map: SourceMapV3;
  try {
    map = JSON.parse(content) as SourceMapV3;
  } catch {
    return null;
  }
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    return null;
  }
  if (map.sections !== undefined) {
    return null;
  }
  if (!Array.isArray(map.sources)) {
    return null;
  }
  const rootPrefix = resolveProjectRoot(projectRoot);
  const sources = (map.sources as unknown[]).map((source) =>
    typeof source === 'string' ? relativizeSource(source, rootPrefix) : source,
  );
  map.sources = sources;
  if (Array.isArray(map.sourcesContent)) {
    map.sourcesContent = (map.sourcesContent as unknown[]).map(
      (item, index) => {
        const source = sources[index];
        if (typeof source === 'string' && isDependencySource(source)) {
          return null;
        }
        return item;
      },
    );
  }
  return JSON.stringify(map);
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/');
}

function resolveProjectRoot(value: string): string {
  const normalized = normalizeSlashes(value);
  // Source-map fixtures and CI metadata may use POSIX roots even when the
  // CLI itself runs on Windows. Do not reinterpret `/work/app` as a drive
  // rooted path; real Windows paths still use the host resolver below.
  return normalized.startsWith('/')
    ? normalizeSlashes(path.posix.resolve(normalized))
    : normalizeSlashes(path.resolve(value));
}

function relativizeSource(source: string, rootPrefix: string): string {
  const normalized = normalizeSlashes(source);
  if (normalized === rootPrefix) {
    return '';
  }
  if (normalized.startsWith(`${rootPrefix}/`)) {
    return normalized.slice(rootPrefix.length + 1);
  }
  return normalized;
}

function isDependencySource(source: string): boolean {
  return (
    source.startsWith('node_modules/') || source.includes('/node_modules/')
  );
}

/**
 * Build the bytes actually archived with a version: the slimmed map (when it
 * is a plain map we understand), gzipped. Source maps are JSON and compress
 * about 5x, which is the difference between a multi-megabyte upload on every
 * publish and a small one. Readers detect the gzip magic bytes rather than
 * trusting a file name, so plain maps archived by older CLI versions keep
 * working unchanged.
 */
export function packSourceMap(content: string, projectRoot: string): Buffer {
  const slimmed = slimSourceMap(content, projectRoot);
  return zlib.gzipSync(Buffer.from(slimmed ?? content, 'utf8'));
}

/** Decode an archived source map: gzip when the magic bytes say so. */
export function unpackSourceMap(data: Buffer): string {
  if (data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b) {
    return zlib.gunzipSync(data).toString('utf8');
  }
  return data.toString('utf8');
}
