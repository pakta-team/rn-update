/**
 * [INPUT]: 依赖 npm registry 元数据、registry-auth-token、代理运行时与用户缓存目录
 * [OUTPUT]: 对外提供 getLatestVersions 与 LatestVersionOptions，查询各包 latest dist-tag
 * [POS]: CLI 自更新提示的版本解析底座，取代 @badisi/latest-version 的裁剪实现
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

// Latest dist-tag lookup on the npm registry, with a per-package metadata
// cache. Trimmed from @badisi/latest-version to what the version check needs;
// the cache location and file format are unchanged.
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import type { IncomingMessage, RequestOptions } from 'http';
import { dirname, join } from 'path';
import registryAuthToken from 'registry-auth-token';
import getRegistryUrl from 'registry-auth-token/registry-url';
import { userCacheDir } from './fs-helpers';
import { proxyAgentFor } from './runtime';

interface PackageMetadata {
  name: string;
  lastUpdateDate: number;
  distTags: Record<string, string>;
  /** registry the metadata came from; a cache from another registry is not reused */
  registryUrl?: string;
}

export interface LatestVersionOptions {
  /**
   * Answer from a cache younger than `cacheMaxAge` (same registry) without
   * any request; otherwise query the registry and refresh the cache, falling
   * back to a stale cache when the query fails.
   */
  useCache?: boolean;
  /** default one day; 0 always refreshes (a stale cache stays the fallback) */
  cacheMaxAge?: number;
  /**
   * Do not let the registry request keep the process alive: its socket is
   * unref'd, so the process may exit before the promise settles.
   */
  unref?: boolean;
  /** request timeout in milliseconds */
  timeout?: number;
}

const ONE_DAY = 1000 * 60 * 60 * 24;

const cacheFile = (pkgName: string) =>
  join(userCacheDir('@badisi/latest-version'), `${pkgName}.json`);

const resolveRegistryUrl = (pkgName: string): string => {
  const i = pkgName.indexOf('/');
  return getRegistryUrl(i !== -1 ? pkgName.slice(0, i) : '');
};

function downloadMetadata(
  pkgName: string,
  options: LatestVersionOptions,
): Promise<PackageMetadata> {
  return new Promise((resolve, reject) => {
    const registryUrl = resolveRegistryUrl(pkgName);
    const pkgUrl = new URL(
      encodeURIComponent(pkgName).replace(/^%40/, '@'),
      registryUrl,
    );
    const headers: Record<string, string> = {
      accept:
        'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*',
    };
    const authInfo = registryAuthToken(pkgUrl.toString(), { recursive: true });
    if (authInfo) {
      headers.authorization = `${authInfo.type} ${authInfo.token}`;
    }
    const requestOptions: RequestOptions = {
      headers,
      host: pkgUrl.hostname,
      path: pkgUrl.pathname,
      port: pkgUrl.port,
      timeout: options.timeout,
      // HTTP(S)_PROXY / NO_PROXY, like every other request of the CLI
      agent: proxyAgentFor(pkgUrl.toString()),
    };

    const { get } = require(pkgUrl.protocol === 'https:' ? 'https' : 'http');
    const request = get(requestOptions, (res: IncomingMessage) => {
      if (res.statusCode !== 200) {
        res.resume(); // consume response data to free up memory
        reject(new Error(`Request error (${res.statusCode}): ${pkgUrl}`));
        return;
      }
      let rawData = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        rawData += chunk;
      });
      res.once('error', reject);
      res.once('end', () => {
        try {
          resolve({
            name: pkgName,
            lastUpdateDate: Date.now(),
            distTags: JSON.parse(rawData)['dist-tags'],
            registryUrl,
          });
        } catch (err) {
          reject(err);
        }
      });
    });
    request.once('timeout', () => {
      request.destroy(new Error(`Request timed out: ${pkgUrl}`));
    });
    request.once('error', reject);
    if (options.unref) {
      // A background check must never delay the process exit: drop the
      // socket's ref (also for a pooled keep-alive socket, which the agent
      // ref's again right before handing it out).
      request.once('socket', (socket: { unref?: () => void }) => {
        socket.unref?.();
      });
    }
  });
}

function saveMetadataToCache(pkg: PackageMetadata): void {
  try {
    const filePath = cacheFile(pkg.name);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(pkg));
  } catch {
    // a read-only or missing cache dir must not turn into an error
  }
}

/**
 * The cached metadata of a package (from the same registry), and whether it is
 * still younger than `cacheMaxAge`. A stale entry is returned as well so it can
 * serve as a fallback when the registry is unreachable.
 */
function getMetadataFromCache(
  pkgName: string,
  maxAge: number,
): { metadata: PackageMetadata; fresh: boolean } | undefined {
  try {
    const metadata = JSON.parse(
      readFileSync(cacheFile(pkgName)).toString(),
    ) as PackageMetadata;
    if (
      !metadata ||
      typeof metadata.lastUpdateDate !== 'number' ||
      !metadata.distTags ||
      metadata.registryUrl !== resolveRegistryUrl(pkgName)
    ) {
      return undefined;
    }
    const age = Date.now() - metadata.lastUpdateDate;
    return { metadata, fresh: maxAge !== 0 && age >= 0 && age < maxAge };
  } catch {
    return undefined; // missing / unreadable / corrupt cache: no cache
  }
}

async function getLatestVersion(
  pkgName: string,
  options: LatestVersionOptions,
): Promise<string | undefined> {
  if (!options.useCache) {
    return (await downloadMetadata(pkgName, options)).distTags.latest;
  }
  const cached = getMetadataFromCache(pkgName, options.cacheMaxAge ?? ONE_DAY);
  if (cached?.fresh) {
    return cached.metadata.distTags.latest;
  }
  try {
    const metadata = await downloadMetadata(pkgName, options);
    saveMetadataToCache(metadata);
    return metadata.distTags.latest;
  } catch (err) {
    if (!cached) {
      throw err;
    }
    return cached.metadata.distTags.latest; // stale beats nothing
  }
}

/** The `latest` dist-tag of each package, `undefined` where unknown. */
export function getLatestVersions(
  pkgNames: string[],
  options: LatestVersionOptions = {},
): Promise<Array<string | undefined>> {
  return Promise.all(
    pkgNames.map((name) =>
      getLatestVersion(name, options).catch(() => undefined),
    ),
  );
}
