/**
 * [INPUT]: 依赖 ZIP/APK/AAB/IPA/Harmony 解析器和摘要计算
 * [OUTPUT]: 对外提供原生包版本、channel、bundleHash 与 opaque buildTime 读取器
 * [POS]: CLI 构建身份解析层，永不把原生构建标识转换成数字
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import chalk from 'chalk';
import { compare } from 'compare-versions';
import path from 'path';
import type { Root as ProtobufRoot } from 'protobufjs';
import { read } from 'read';
import pkg from '../../package.json';
import { checkPlugins } from './check-plugin';
import { getDepVersion } from './dep-versions';
import { sha256Hex as sha256 } from './hash';
import { isStandaloneService } from './http-helper';
import { t } from './i18n';
import { isTruthyEnv } from './options';
import { readFirstEntry } from './zip-entries';

// app-info-parser (and its zip/plist/protobuf stack) is only needed by the
// package commands; load it on first use instead of on every CLI start.
function loadAppInfoParser() {
  return {
    ...(require('./app-info-parser/apk') as typeof import('./app-info-parser/apk')),
    ...(require('./app-info-parser/ipa') as typeof import('./app-info-parser/ipa')),
    ...(require('./app-info-parser/zip') as typeof import('./app-info-parser/zip')),
  };
}

/**
 * tty-table (~25 ms to load) only when a table is rendered. Bun's require of
 * a CJS module can hand back a namespace object, so unwrap `default`.
 */
export function loadTtyTable(): typeof import('tty-table') {
  const mod = require('tty-table');
  return (mod.default ?? mod) as typeof import('tty-table');
}

type ParsedIpaInfo = {
  CFBundleShortVersionString: string;
  channel?: string;
};

type ParsedAppMetaInfo = {
  versionName?: string;
  pakta_build_time?: number | string;
  channel?: string;
};

type AabXmlAttr = {
  name: string;
  value: string;
  compiledItem?: {
    ref?: {
      id?: number;
    };
    prim?: {
      intDecimalValue?: number;
    };
  };
};

type AabXmlElement = {
  name: string;
  attribute: AabXmlAttr[];
  child: Array<{ element?: AabXmlElement }>;
};

type AabXmlNodeObject = {
  element: AabXmlElement;
};

type AabResourceEntry = {
  entryId: number;
  configValue?: Array<{
    value?: {
      item?: {
        str?: {
          value?: string;
        };
      };
    };
  }>;
};

type AabResourceType = {
  typeId: number;
  entry: AabResourceEntry[];
};

type AabResourcePackage = {
  packageId: number;
  type: AabResourceType[];
};

type AabResourceTableObject = {
  package: AabResourcePackage[];
};

/** True when prompts cannot or must not be shown. */
export function isNonInteractive(
  env: NodeJS.ProcessEnv = process.env,
  stdinIsTTY: boolean | undefined = process.stdin.isTTY,
  globalFlag: boolean | undefined = global.NO_INTERACTIVE,
) {
  return (
    globalFlag === true ||
    isTruthyEnv(env.NO_INTERACTIVE) ||
    stdinIsTTY !== true
  );
}

export async function question(query: string, password?: boolean) {
  if (isNonInteractive()) {
    return '';
  }
  return read({
    prompt: query,
    silent: password,
    replace: password ? '*' : undefined,
  });
}

/** Expand `${name}` placeholders in string options from other options or the environment. */
export function translateOptions<T extends Record<string, unknown>>(
  options: T,
): T & Record<string, unknown> {
  const ret: Record<string, unknown> = {};
  for (const key in options) {
    const value = options[key];
    if (typeof value === 'string') {
      ret[key] = value.replace(/\$\{(\w+)\}/g, (placeholder, name) => {
        const replacement = options[name] ?? process.env[name];
        if (
          typeof replacement === 'string' ||
          typeof replacement === 'number' ||
          typeof replacement === 'boolean'
        ) {
          return String(replacement);
        }
        return placeholder;
      });
    } else {
      ret[key] = value;
    }
  }
  return ret as T & Record<string, unknown>;
}

// bundleHash: sha256 of the raw bundle bytes extracted from the package. Must
// stay byte-identical with what the client hashes at runtime (its embedded
// bundle, which is also the pdiff source) — the server compares the two to
// decide pdiff applicability. Raw bytes, no normalization of any kind.
function requireBundle(
  bundleFile: Buffer | undefined,
  packageType: string,
  entryFile: string,
): Buffer {
  if (!bundleFile) {
    throw new Error(t('bundleNotFound', { packageType, entryFile }));
  }
  return bundleFile;
}

/** 构建标识按不透明字符串保存：第 3 方原生包不得被转换成数字而丢失精度。 */
function requireBuildTime(value: unknown): string {
  const buildTime = value === undefined || value === null ? '' : String(value);
  if (!buildTime || buildTime === '0') {
    throw new Error(t('buildTimeNotFound'));
  }
  return buildTime;
}

/** The common shape of getApkInfo / getAppInfo / getIpaInfo. */
function nativePackageInfo(
  versionName: unknown,
  buildTime: string,
  bundleFile: Buffer,
  updateJson: Buffer | undefined,
  platform: 'android' | 'harmony' | 'ios',
  channel = 'default',
) {
  const appCredential = updateJson
    ? JSON.parse(updateJson.toString())[platform]
    : {};
  return {
    versionName,
    buildTime,
    bundleHash: sha256(bundleFile),
    bundleFile,
    ...appCredential,
    channel,
  };
}

// Anchored exact paths: unanchored/unescaped patterns also matched entries
// like index.android.bundle.map or .backup, and a later match would silently
// overwrite the real bundle, registering a wrong bundleHash.
export const ApkBundleFileName = /^assets\/index\.android\.bundle$/;
const ApkUpdateJsonName = /^res\/raw\/update\.json$/;
const ApkManifestName = /^androidmanifest\.xml$/;
const ApkResourcesName = /^resources\.arsc$/;

export async function getApkInfo(fn: string) {
  const { parseApkManifest, readZipEntries } = loadAppInfoParser();
  // read every entry in a single scan over the archive
  const [bundleFile, updateJson, manifest, resources] = await readZipEntries(
    fn,
    [ApkBundleFileName, ApkUpdateJsonName, ApkManifestName, ApkResourcesName],
  );
  const bundle = requireBundle(bundleFile, 'apk', 'index.android.bundle');
  if (!manifest) {
    throw new Error("AndroidManifest.xml can't be found.");
  }
  const { versionName, metaData } = parseApkManifest(manifest, resources);
  let buildTime: unknown;
  let channel = 'default';
  for (const meta of metaData) {
    if (meta.name === 'pakta_build_time') {
      buildTime = Array.isArray(meta.value) ? meta.value[0] : meta.value;
    }
    if (meta.name === 'channel' && meta.value !== undefined) {
      const value = Array.isArray(meta.value) ? meta.value[0] : meta.value;
      channel = String(value).trim() || 'default';
    }
  }
  return nativePackageInfo(
    versionName,
    requireBuildTime(buildTime),
    bundle,
    updateJson,
    'android',
    channel,
  );
}

export async function getAppInfo(fn: string) {
  const { readZipEntries } = loadAppInfoParser();
  // single scan (and single nested .hap extraction) for all three entries
  const [bundleFile, updateJson, metaJson] = await readZipEntries(fn, [
    /^resources\/rawfile\/bundle\.harmony\.js$/,
    /^resources\/rawfile\/update\.json$/,
    /^resources\/rawfile\/meta\.json$/,
  ]);
  const bundle = requireBundle(bundleFile, 'app', 'bundle.harmony.js');
  const {
    versionName,
    pakta_build_time,
    channel: parsedChannel,
  } = (metaJson ? JSON.parse(metaJson.toString()) : {}) as ParsedAppMetaInfo;
  const channel =
    typeof parsedChannel === 'string' && parsedChannel.trim()
      ? parsedChannel.trim()
      : 'default';
  return nativePackageInfo(
    versionName,
    requireBuildTime(pakta_build_time),
    bundle,
    updateJson,
    'harmony',
    channel,
  );
}

// lowercase because the zip reader also matches against the lowercased entry
// name (real IPAs use "Payload/")
export const IpaBundleFileName = /^payload\/[^/]+\.app\/main\.jsbundle$/;
const IpaUpdateJsonName = /^payload\/[^/]+\.app\/assets\/update\.json$/;
const IpaPlistName = /payload\/[^/]+?.app\/info.plist$/i;
const IpaBuildTimeName = /^payload\/[^/]+\.app\/pakta_build_time\.txt$/;
// Not in root bundle when use `use_frameworks`
const IpaBuildTimeFrameworkName =
  /^payload\/[^/]+\.app\/frameworks\/react_native_update\.framework\/pakta_build_time\.txt$/;

export async function getIpaInfo(fn: string) {
  const { parsePlist, readZipEntries } = loadAppInfoParser();
  // read every entry in a single scan over the archive
  const [bundleFile, updateJson, plist, buildTimeTxt, frameworkBuildTimeTxt] =
    await readZipEntries(fn, [
      IpaBundleFileName,
      IpaUpdateJsonName,
      IpaPlistName,
      IpaBuildTimeName,
      IpaBuildTimeFrameworkName,
    ]);
  const bundle = requireBundle(bundleFile, 'ipa', 'main.jsbundle');
  if (!plist) {
    throw new Error("Info.plist can't be found.");
  }
  const { CFBundleShortVersionString: versionName, channel: parsedChannel } =
    (await parsePlist(plist)) as ParsedIpaInfo;
  const buildTimeTxtBuffer = buildTimeTxt ?? frameworkBuildTimeTxt;
  if (!buildTimeTxtBuffer) {
    throw new Error(t('buildTimeNotFound'));
  }
  const channel =
    typeof parsedChannel === 'string' && parsedChannel.trim()
      ? parsedChannel.trim()
      : 'default';
  return nativePackageInfo(
    versionName,
    requireBuildTime(buildTimeTxtBuffer.toString().trim()),
    bundle,
    updateJson,
    'ios',
    channel,
  );
}

export async function getAabInfo(fn: string) {
  const protobuf = require('protobufjs') as typeof import('protobufjs');
  const root = await protobuf.load(
    path.join(__dirname, '../../proto/Resources.proto'),
  );
  const XmlNode = root.lookupType('aapt.pb.XmlNode');

  const buffer = await readZipEntry(fn, 'base/manifest/AndroidManifest.xml');

  const message = XmlNode.decode(buffer);
  const object = XmlNode.toObject(message, {
    enums: String,
    longs: String,
    bytes: String,
    defaults: true,
    arrays: true,
  }) as AabXmlNodeObject;

  const manifestElement = object.element;
  if (manifestElement.name !== 'manifest') {
    throw new Error(t('invalidManifest'));
  }

  let versionName = '';
  for (const attr of manifestElement.attribute) {
    if (attr.name === 'versionName') {
      versionName = attr.value;
    }
  }

  let buildTime = '';
  let channel = 'default';
  const appCredential = {};

  // Find application node
  const applicationNode = manifestElement.child.find(
    (child) => child.element?.name === 'application',
  );
  const applicationElement = applicationNode?.element;
  if (applicationElement) {
    const metaDataNodes = applicationElement.child.filter(
      (child) => child.element?.name === 'meta-data',
    );
    for (const meta of metaDataNodes) {
      let name = '';
      let value = '';
      let resourceId = 0;

      const metaElement = meta.element;
      if (!metaElement) {
        continue;
      }
      for (const attr of metaElement.attribute) {
        if (attr.name === 'name') {
          name = attr.value;
        }
        if (attr.name === 'value') {
          value = attr.value;
          if (attr.compiledItem?.ref?.id) {
            resourceId = attr.compiledItem.ref.id;
          } else if (attr.compiledItem?.prim?.intDecimalValue) {
            value = attr.compiledItem.prim.intDecimalValue.toString();
          }
        }
      }

      if (name === 'pakta_build_time') {
        if (resourceId > 0) {
          const resolvedValue = await resolveResource(fn, resourceId, root);
          if (resolvedValue) {
            value = resolvedValue;
          }
        }
        buildTime = String(value);
      }
      if (name === 'channel') {
        channel = value.trim() || 'default';
      }
    }
  }

  if (!buildTime || buildTime === '0') {
    throw new Error(t('buildTimeNotFound'));
  }

  // The JS bundle lives in the base module; these are the same bytes the
  // extracted APK carries (extractApk copies entries verbatim), so the hash
  // matches what uploadAab ends up registering via getApkInfo. Lenient on
  // absence — getAabInfo is display-only (parseAab); the upload path goes
  // through extractApk → getApkInfo which enforces the bundle's presence.
  let bundleHash: string | undefined;
  try {
    bundleHash = sha256(
      await readZipEntry(fn, 'base/assets/index.android.bundle'),
    );
  } catch {
    // no embedded bundle (e.g. debug AAB); omit the field
  }

  return {
    versionName,
    buildTime,
    ...(bundleHash ? { bundleHash } : {}),
    ...appCredential,
    channel,
  };
}

async function readZipEntry(fn: string, entryName: string): Promise<Buffer> {
  const data = await readFirstEntry(fn, (name) => name === entryName);
  if (!data) throw new Error(`${entryName} not found in AAB`);
  return data;
}

async function resolveResource(
  fn: string,
  resourceId: number,
  root: ProtobufRoot,
): Promise<string | null> {
  const pkgId = (resourceId >> 24) & 0xff;
  const typeId = (resourceId >> 16) & 0xff;
  const entryId = resourceId & 0xffff;

  try {
    const buffer = await readZipEntry(fn, 'base/resources.pb');
    const ResourceTable = root.lookupType('aapt.pb.ResourceTable');
    const message = ResourceTable.decode(buffer);
    const object = ResourceTable.toObject(message, {
      enums: String,
      longs: String,
      bytes: String,
      defaults: true,
      arrays: true,
    }) as AabResourceTableObject;

    // Find package
    const pkg = object.package.find((pkgItem) => pkgItem.packageId === pkgId);
    if (!pkg) return null;

    // Find type
    const type = pkg.type.find((typeItem) => typeItem.typeId === typeId);
    if (!type) return null;

    // Find entry
    const entry = type.entry.find((entryItem) => entryItem.entryId === entryId);
    if (!entry) return null;

    // Get value from configValue
    if (entry.configValue && entry.configValue.length > 0) {
      const val = entry.configValue[0]?.value;
      const stringValue = val?.item?.str?.value;
      if (typeof stringValue === 'string') {
        return stringValue;
      }
    }
  } catch (e) {
    console.warn(t('failedToResolveResource', { error: e }));
  }
  return null;
}

const VERSION_CHECK_PACKAGES = ['rn-update-cli', 'rn-update'];

/**
 * Latest registry versions of the CLI and the client library, in that order
 * (`undefined` where unknown). Never rejects.
 *
 * `background: true` answers from a 1-day cache when possible and otherwise
 * refreshes it with an unref'd request, so the process is free to exit before
 * the registry answers; `background: false` always asks the registry and
 * waits (refreshing the cache on the way).
 */
async function getLatestVersions(
  background: boolean,
): Promise<Array<string | undefined>> {
  // the registry client pulls in registry-auth-token: only pay for it when
  // actually checking
  const { getLatestVersions: fetchLatestVersions } =
    require('./latest-version') as typeof import('./latest-version');
  return fetchLatestVersions(VERSION_CHECK_PACKAGES, {
    useCache: true,
    ...(background ? { unref: true } : { cacheMaxAge: 0 }),
    timeout: 2000,
  });
}

function isNewer(latest: string | undefined, current: string | undefined) {
  if (!latest || !current) {
    return false;
  }
  try {
    return compare(latest, current, '>');
  } catch {
    return false;
  }
}

function latestTag(version: string | undefined) {
  return version
    ? ` ${t('latestVersionTag', { version: chalk.green(version) })}`
    : '';
}

export interface VersionCheck {
  /** settles once the registry check has finished (or failed); never rejects */
  done: Promise<void>;
  /** wait for the check, but never longer than `graceMs` */
  settle: (graceMs: number) => Promise<void>;
  /** launch a detached self-update after the foreground command is done */
  startAutoUpdate: () => void;
  /**
   * Print the "newer version available" hints if the check has completed by
   * now; a no-op while it is still pending, when nothing is newer, and after
   * the first call. Safe to call from a process 'exit' handler.
   */
  printHints: () => void;
}

/**
 * Print the installed CLI / rn-update versions (and refuse or warn
 * about unsupported client versions) immediately, without touching the
 * network.
 *
 * With `wait: true` (the `-v`/`version` command) the registry is queried
 * first and the latest versions are printed inline. Otherwise the registry
 * check runs in the background and the returned `printHints` shows what is
 * newer once the command is done — the command itself is never delayed by it.
 */
export async function printVersionCommand({
  wait = true,
}: {
  wait?: boolean;
} = {}): Promise<VersionCheck> {
  // one dependency, not the whole map: this runs before every command
  const rnuVersion = getDepVersion('rn-update');
  const standalone = isStandaloneService();

  let latest: Array<string | undefined> | undefined;
  const check = (
    standalone ? Promise.resolve([]) : getLatestVersions(!wait)
  ).then((versions) => {
    latest = versions;
  });
  if (wait) {
    await check;
  }
  const [latestCliVersion, latestRnuVersion] = latest ?? [];

  console.log(`rn-update-cli: ${pkg.version}${latestTag(latestCliVersion)}`);
  try {
    const { consumeAutoUpdateNotice } =
      require('../auto-update') as typeof import('../auto-update');
    const notice = standalone
      ? undefined
      : consumeAutoUpdateNotice(pkg.version);
    if (notice?.kind === 'updated') {
      console.log(
        t('autoUpdateSuccess', {
          from: notice.currentVersion,
          to: notice.targetVersion,
        }),
      );
    } else if (notice?.kind === 'permission') {
      console.warn(
        t('autoUpdatePermission', {
          command: notice.command,
        }),
      );
    }
  } catch {
    // A corrupt/unwritable updater cache cannot affect normal commands.
  }
  if (rnuVersion) {
    console.log(`rn-update: ${rnuVersion}${latestTag(latestRnuVersion)}`);
  } else {
    console.log(t('rnuVersionNotFound'));
  }

  let hinted = wait; // inline tags already shown
  const printHints = () => {
    if (hinted || !latest) {
      return;
    }
    hinted = true;
    const [cliLatest, rnuLatest] = latest;
    if (isNewer(cliLatest, pkg.version)) {
      console.log(`rn-update-cli: ${pkg.version}${latestTag(cliLatest)}`);
    }
    if (rnuVersion && isNewer(rnuLatest, rnuVersion)) {
      console.log(`rn-update: ${rnuVersion}${latestTag(rnuLatest)}`);
    }
  };

  const settle = (graceMs: number) => {
    let timer: NodeJS.Timeout | undefined;
    const grace = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, graceMs);
    });
    return Promise.race([check, grace]).then(() => clearTimeout(timer));
  };

  let autoUpdateStarted = false;
  const startAutoUpdate = () => {
    if (standalone || autoUpdateStarted || !isNewer(latest?.[0], pkg.version)) {
      return;
    }
    autoUpdateStarted = true;
    try {
      const { launchAutoUpdate } =
        require('../auto-update') as typeof import('../auto-update');
      launchAutoUpdate(pkg.version, latest?.[0]);
    } catch {
      // Self-update is strictly opportunistic and never affects the command.
    }
  };

  return { done: check, settle, startAutoUpdate, printHints };
}

export { checkPlugins };
