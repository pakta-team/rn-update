/**
 * [INPUT]: 依赖 node:fs 与 fs-helpers.remove 管理原生包临时目录，依赖原生包解析器、对象上传 API、应用选择、channel 自动创建/断言与本地化文案
 * [OUTPUT]: 对外提供三端原生包登记/列表/删除/解析命令，上传前执行版本组 JS 一致性与精确身份幂等检查
 * [POS]: CLI 原生构建边界，在上传字节前阻断同版本换 JS，并把合法精简制品、Range 与 buildTime 绑定到 NativeVersion
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import * as fs from 'fs';
import os from 'os';
import path from 'path';
import {
  doDelete,
  getAllPackages,
  getApiToken,
  getMembershipEntitlement,
  getSession,
  post,
  servicePath,
  unwrapData,
  uploadFile,
} from './api';
import { getOrCreateChannel, getSelectedApp, resolveAppId } from './app';
import { createSlimNativePackage } from './native-package';
import type { Package, Platform } from './types';
import {
  getAabInfo,
  getApkInfo,
  getAppInfo,
  getIpaInfo,
  isNonInteractive,
  loadTtyTable,
  question,
} from './utils';
import { pricingPageUrl, updateJson } from './utils/constants';
import { getDepVersions } from './utils/dep-versions';
import { remove } from './utils/fs-helpers';
import { getCommitInfo } from './utils/git';
import {
  bundleEntryMatcher,
  cachePut,
  reportedBytecodeVersion,
} from './utils/hermes-base';
import { isStandaloneService } from './utils/http-helper';
import { t } from './utils/i18n';
import { getStringListOption } from './utils/options';
import { bundleLocationFields, locateZipEntry } from './utils/zip-range';

// parse* 输出 JSON，便于把 bundleHash（内容指纹）管道给 jq；原始 bundle 字节剔除，
// Buffer 预览只是噪声。
function printPackageInfo({
  bundleFile: _bundleFile,
  ...info
}: Record<string, unknown>) {
  console.log(JSON.stringify(info, null, 2));
}

type PackageCommandOptions = Record<string, unknown> & {
  appId?: string;
  appKey?: string;
  config?: string;
  platform?: Platform;
  version?: string;
  packageId?: string;
  packageIds?: string;
  packageVersion?: string;
  /** Assertion only: must equal the immutable channel embedded in the package. */
  channel?: string;
  includeAllSplits?: boolean | string;
  splits?: string;
  output?: string;
};

type PackageVersionRef = {
  id?: string | number;
  name?: string | number;
};

type NativePackageInfo = {
  versionName?: string | number;
  buildTime?: string;
  /** sha256 of the JS bundle embedded in the package (content identity) */
  bundleHash?: string;
  channel?: string;
  appId?: string;
  appKey?: string;
  [key: string]: unknown;
};

type NativeUploadConfig = {
  extension: '.ipa' | '.apk' | '.app';
  platform: Platform;
  appIdMismatchKey: string;
  appKeyMismatchKey: string;
  successKey: string;
  getInfo: (filePath: string) => Promise<NativePackageInfo>;
  normalizeBuildTime?: (
    buildTime: NativePackageInfo['buildTime'],
  ) => string | undefined;
};

// the AAB parser drags in protobufjs; load it only for the aab commands
function loadExtractApk() {
  return (
    require('./utils/app-info-parser/aab') as typeof import('./utils/app-info-parser/aab')
  ).extractApk;
}

export function normalizeUploadBuildTime(value: unknown): string {
  return String(value);
}

function ensureFileByExt(
  filePath: string | undefined,
  extension: NativeUploadConfig['extension'] | '.aab',
  usageKey: string,
): string {
  if (!filePath?.endsWith(extension)) {
    throw new Error(t(usageKey));
  }
  return filePath;
}

async function assertNativePackageSize(filePath: string, appId: string) {
  if (!isStandaloneService()) return;
  // An unauthenticated legacy invocation cannot read account entitlements;
  // let the existing upload endpoint enforce its server-side limit. As soon
  // as a session or API key is present, fail before parsing/slimming bytes.
  if (!getApiToken() && !getSession()) return;
  // Harmony .app is a directory containing nested .hap archives. statSync on
  // the directory only returns filesystem metadata, so quota checks must sum
  // every regular file before any parser, slimming, or upload side effect.
  const fileSize = measurePackageBytes(filePath);
  const entitlement = await getMembershipEntitlement(appId);
  const maxBytes = Number(entitlement.nativePackageMaxBytes);
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new Error(t('nativePackageQuotaMissing'));
  }
  if (fileSize > maxBytes) {
    throw new Error(
      t('fileSizeExceeded', {
        fileSize: `${(fileSize / 1048576).toFixed(1)} MB`,
        maxSize: `${(maxBytes / 1048576).toFixed(0)} MB`,
        pricingPageUrl,
      }),
    );
  }
}

function measurePackageBytes(filePath: string): number {
  const stat = fs.lstatSync(filePath);
  if (!stat.isDirectory()) {
    return stat.size;
  }
  return fs
    .readdirSync(filePath)
    .reduce(
      (total, entry) => total + measurePackageBytes(path.join(filePath, entry)),
      0,
    );
}

function parseBooleanOption(value: unknown): boolean {
  return value === true || value === 'true';
}

function parseCsvOption(value: unknown): string[] | null {
  if (typeof value !== 'string') {
    return null;
  }
  const parsed = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : null;
}

function toNumericIds(ids: string[]) {
  return ids.map((id) => {
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      throw new Error(t('invalidId', { id }));
    }
    return numericId;
  });
}

function getVersionBinding(version: unknown): PackageVersionRef | undefined {
  if (!version || typeof version !== 'object') {
    return undefined;
  }

  const v = version as PackageVersionRef;
  return { id: v.id, name: v.name };
}

async function uploadNativePackage(
  filePath: string,
  options: PackageCommandOptions,
  config: NativeUploadConfig,
): Promise<void> {
  const selectedApp = options.appId
    ? {
        appId: String(options.appId),
        appKey: typeof options.appKey === 'string' ? options.appKey : undefined,
      }
    : await getSelectedApp(config.platform, options.config);
  const { appId, appKey } = selectedApp;
  await assertNativePackageSize(filePath, appId);
  const info = await config.getInfo(filePath);
  const {
    versionName: extractedVersionName,
    buildTime,
    bundleHash,
    channel: rawChannel = 'default',
  } = info;
  const channel = String(rawChannel).trim();
  const bundleFile = (info as { bundleFile?: Buffer }).bundleFile;
  const { appId: appIdInPkg, appKey: appKeyInPkg } = info;
  // where the expected app came from, for the mismatch messages
  const source = options.appId ? '--appId' : options.config || updateJson;

  if (options.channel !== undefined && options.channel !== channel) {
    throw new Error(
      t('channelAssertionFailed', {
        channel,
        requestedChannel: options.channel,
      }),
    );
  }

  if (appIdInPkg && String(appIdInPkg) !== appId) {
    throw new Error(t(config.appIdMismatchKey, { appIdInPkg, appId, source }));
  }

  if (appKeyInPkg && appKey && appKeyInPkg !== appKey) {
    throw new Error(
      t(config.appKeyMismatchKey, { appKeyInPkg, appKey, source }),
    );
  }

  const customVersion =
    typeof options.version === 'string' && options.version
      ? options.version
      : undefined;
  const versionName = customVersion ?? extractedVersionName;
  if (customVersion !== undefined) {
    console.log(t('usingCustomVersion', { version: versionName }));
  }

  const normalizedBuildTime = config.normalizeBuildTime
    ? config.normalizeBuildTime(buildTime)
    : buildTime;
  const uploadBuildTime = normalizeUploadBuildTime(normalizedBuildTime);
  let standaloneChannelId: string | undefined;
  if (isStandaloneService()) {
    if (!bundleHash) {
      throw new Error(t('bundleHashRequired'));
    }
    const resolvedChannel = await getOrCreateChannel(appId, channel);
    if (resolvedChannel.created) {
      console.log(t('channelAutoCreated', { channel }));
    }
    standaloneChannelId = resolvedChannel.channel.id;

    const versionGroup = ((await getAllPackages(appId)) ?? []).filter(
      (item) =>
        item.channelId === standaloneChannelId &&
        String(item.versionName ?? item.name) === String(versionName),
    );
    if (versionGroup.some((item) => item.bundleHash !== bundleHash)) {
      throw new Error(
        t('nativeVersionBundleConflict', { version: versionName }),
      );
    }
    const duplicate = versionGroup.find(
      (item) =>
        item.bundleHash === bundleHash &&
        String(item.buildTime ?? '') === uploadBuildTime,
    );
    if (duplicate) {
      console.log(
        t('nativeVersionAlreadyRegistered', {
          version: versionName,
          id: duplicate.id,
        }),
      );
      return;
    }
  }

  const tempRoot = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'rnu-native-package-upload-'),
  );
  const slimPackagePath = path.join(tempRoot, `package${config.extension}`);
  try {
    await createSlimNativePackage(filePath, slimPackagePath, config.platform);
    const uploaded = await uploadFile(slimPackagePath, appId);
    const { hash } = uploaded;
    // where the bundle sits inside the uploaded (slim) archive, so a later
    // `bundle` that falls back to this package as hermes base fetches only
    // the bundle with one HTTP Range request. Harmony .app nests a second
    // zip, so no location is reported for it.
    const bundleLocation =
      config.extension === '.app'
        ? {}
        : bundleLocationFields(
            await locateZipEntry(
              slimPackagePath,
              bundleEntryMatcher(config.extension.slice(1) as 'apk' | 'ipa'),
            ).catch(() => null),
          );
    if (bundleFile) {
      // keep the embedded bundle locally so a later `bundle` can use it as
      // hermes base without downloading it back (see hermes-base.ts); getInfo
      // already hashed the bundle, so pass that hash instead of hashing twice
      await cachePut(bundleFile, undefined, bundleHash).catch(() => {});
    }
    let id: string | number;
    if (isStandaloneService()) {
      const nativeVersion = unwrapData<{ id: string }>(
        await post(servicePath(`/apps/${encodeURIComponent(appId)}/versions`), {
          channelId: standaloneChannelId,
          packageVersion: String(versionName),
          bundleHash,
          buildTime: uploadBuildTime,
          packageKey: uploaded.key || uploaded.hash,
          downloadUrl: uploaded.url,
          ...bundleLocation,
        }),
      );
      id = nativeVersion.id;
    } else {
      const result = await post(`/app/${appId}/package/create`, {
        name: versionName,
        hash,
        buildTime: uploadBuildTime,
        channel,
        // Content identity of the embedded JS bundle; the server matches it
        // against the client-reported bundleHash to decide pdiff applicability.
        // Old servers strip unknown fields, so this is forward-compatible.
        ...(bundleHash ? { bundleHash } : {}),
        // HBC 版本（0 = 纯 JS），服务端只会把匹配编译基线的包当作 Hermes base
        ...(bundleFile
          ? { bytecodeVersion: reportedBytecodeVersion(bundleFile) }
          : {}),
        ...bundleLocation,
        deps: getDepVersions(),
        commit: await getCommitInfo(),
      });
      id = result.id;
    }
    console.log(
      t(config.successKey, {
        id,
        version: versionName,
        buildTime: uploadBuildTime,
      }),
    );
  } finally {
    await remove(tempRoot);
  }
}

/**
 * Print the app's native packages. Pass `packages` when the caller already
 * fetched them (every page of the list), to skip fetching them again.
 */
export async function listPackage(appId: string, packages?: Package[]) {
  const allPkgs = packages ?? (await getAllPackages(appId)) ?? [];

  const header = [
    { value: t('nativePackageId') },
    { value: t('nativeVersion') },
  ];
  const rows = [];
  for (const pkg of allPkgs) {
    const { version } = pkg;
    let versionInfo = '';
    if (version) {
      const versionObj = getVersionBinding(version);
      versionInfo = t('boundTo', {
        name: versionObj?.name ?? version,
        id: versionObj?.id ?? version,
      });
    }
    let output = pkg.name;
    if (pkg.status === 'paused') {
      output += t('pausedStatus');
    }
    if (pkg.status === 'expired') {
      output += t('expiredStatus');
    }
    output += versionInfo;
    if (pkg.channel) output += ` · channel=${pkg.channel}`;
    rows.push([pkg.id, output]);
  }

  // tty-table is ~25 ms to load; only pay for it when a table is rendered
  const Table = loadTtyTable();
  console.log(Table(header, rows).render());
  console.log(t('totalPackages', { count: allPkgs.length }));
  return allPkgs;
}

export async function choosePackage(appId: string, packages?: Package[]) {
  // Fail before fetching or rendering the package list when no prompt exists.
  if (isNonInteractive()) {
    throw new Error(t('packageIdRequired'));
  }
  const list = await listPackage(appId, packages);
  const packageMap = new Map(list?.map((v) => [v.id.toString(), v]));

  while (true) {
    const id = await question(t('enterNativePackageId'));
    const app = packageMap.get(id);
    if (app) {
      return app;
    }
  }
}

export const packageCommands = {
  uploadIpa: async ({
    args,
    options,
  }: {
    args: string[];
    options: PackageCommandOptions;
  }) => {
    const fn = ensureFileByExt(args[0], '.ipa', 'usageUploadIpa');
    await uploadNativePackage(fn, options, {
      extension: '.ipa',
      platform: 'ios',
      appIdMismatchKey: 'appIdMismatchIpa',
      appKeyMismatchKey: 'appKeyMismatchIpa',
      successKey: 'ipaUploadSuccess',
      getInfo: (filePath) => getIpaInfo(filePath),
    });
  },
  uploadApk: async ({
    args,
    options,
  }: {
    args: string[];
    options: PackageCommandOptions;
  }) => {
    const fn = ensureFileByExt(args[0], '.apk', 'usageUploadApk');
    await uploadNativePackage(fn, options, {
      extension: '.apk',
      platform: 'android',
      appIdMismatchKey: 'appIdMismatchApk',
      appKeyMismatchKey: 'appKeyMismatchApk',
      successKey: 'apkUploadSuccess',
      getInfo: (filePath) => getApkInfo(filePath),
    });
  },
  uploadAab: async ({
    args,
    options,
  }: {
    args: string[];
    options: PackageCommandOptions;
  }) => {
    const source = ensureFileByExt(args[0], '.aab', 'usageUploadAab');

    const selectedApp = options.appId
      ? { appId: String(options.appId) }
      : await getSelectedApp('android', options.config);
    await assertNativePackageSize(source, selectedApp.appId);

    // private temp dir: unpredictable path, safe against symlink squatting in
    // the shared tmpdir and against concurrent uploads of same-named AABs
    const tempRoot = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'rnu-aab-upload-'),
    );
    const output = path.join(tempRoot, 'universal.apk');

    const includeAllSplits = parseBooleanOption(options.includeAllSplits);
    const splits = parseCsvOption(options.splits);

    try {
      await loadExtractApk()(source, output, {
        includeAllSplits,
        splits,
      });
      await packageCommands.uploadApk({
        args: [output],
        options,
      });
    } finally {
      await remove(tempRoot);
    }
  },
  uploadApp: async ({
    args,
    options,
  }: {
    args: string[];
    options: PackageCommandOptions;
  }) => {
    const fn = ensureFileByExt(args[0], '.app', 'usageUploadApp');
    await uploadNativePackage(fn, options, {
      extension: '.app',
      platform: 'harmony',
      appIdMismatchKey: 'appIdMismatchApp',
      appKeyMismatchKey: 'appKeyMismatchApp',
      successKey: 'appUploadSuccess',
      getInfo: (filePath) => getAppInfo(filePath),
      normalizeBuildTime: (buildTime) => String(buildTime),
    });
  },
  parseApp: async ({ args }: { args: string[] }) => {
    const fn = args[0];
    if (!fn?.endsWith('.app')) {
      throw new Error(t('usageParseApp'));
    }
    printPackageInfo(await getAppInfo(fn));
  },
  parseIpa: async ({ args }: { args: string[] }) => {
    const fn = args[0];
    if (!fn?.endsWith('.ipa')) {
      throw new Error(t('usageParseIpa'));
    }
    printPackageInfo(await getIpaInfo(fn));
  },
  parseApk: async ({ args }: { args: string[] }) => {
    const fn = args[0];
    if (!fn?.endsWith('.apk')) {
      throw new Error(t('usageParseApk'));
    }
    printPackageInfo(await getApkInfo(fn));
  },
  parseAab: async ({ args }: { args: string[] }) => {
    const fn = args[0];
    if (!fn?.endsWith('.aab')) {
      throw new Error(t('usageParseAab'));
    }
    printPackageInfo(await getAabInfo(fn));
  },
  extractApk: async ({
    args,
    options,
  }: {
    args: string[];
    options: PackageCommandOptions;
  }) => {
    const source = ensureFileByExt(args[0], '.aab', 'usageExtractApk');

    const output =
      options.output ||
      path.join(
        path.dirname(source),
        `${path.basename(source, path.extname(source))}.apk`,
      );

    const includeAllSplits = parseBooleanOption(options.includeAllSplits);
    const splits = parseCsvOption(options.splits);

    await loadExtractApk()(source, output, {
      includeAllSplits,
      splits,
    });

    console.log(t('apkExtracted', { output }));
  },
  packages: async ({
    options,
  }: {
    options: { platform: Platform; appId?: string; config?: string };
  }) => {
    await listPackage(await resolveAppId(options));
  },
  deletePackage: async ({ options }: { options: PackageCommandOptions }) => {
    const appId = await resolveAppId(options);
    let packageIds =
      getStringListOption(options, 'packageIds') ??
      getStringListOption(options, 'packageId');

    if (!packageIds) {
      const packageVersions = getStringListOption(options, 'packageVersion');
      if (!packageVersions) {
        throw new Error(t('usageDeletePackage'));
      }

      const allPkgs = await getAllPackages(appId);
      if (!allPkgs) {
        throw new Error(t('noPackagesFound', { appId }));
      }

      const allPkgsMap = new Map(allPkgs.map((pkg) => [pkg.name, pkg]));

      packageIds = packageVersions.map((packageVersion) => {
        const selectedPackage = allPkgsMap.get(packageVersion);
        if (!selectedPackage) {
          throw new Error(t('packageNotFound', { packageVersion }));
        }
        return String(selectedPackage.id);
      });
    }

    // Confirm deletion
    // const confirmDelete = await question(
    //   t('confirmDeletePackage', { packageId }),
    // );

    // if (
    //   confirmDelete.toLowerCase() !== 'y' &&
    //   confirmDelete.toLowerCase() !== 'yes'
    // ) {
    //   console.log(t('cancelled'));
    //   return;
    // }

    try {
      if (isStandaloneService()) {
        for (const packageId of packageIds) {
          await doDelete(
            servicePath(`/versions/${encodeURIComponent(packageId)}`),
          );
        }
        console.log(
          t('deletePackagesSuccess', {
            count: packageIds.length,
            packageIds: packageIds.join(', '),
          }),
        );
        return;
      }
      if (packageIds.length === 1) {
        const [packageId] = packageIds;
        await doDelete(`/app/${appId}/package/${packageId}`);
        console.log(t('deletePackageSuccess', { packageId }));
      } else {
        await doDelete(`/app/${appId}/package`, {
          packageIds: toNumericIds(packageIds),
        });
        console.log(
          t('deletePackagesSuccess', {
            count: packageIds.length,
            packageIds: packageIds.join(', '),
          }),
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        t('deletePackageError', {
          packageId: packageIds.join(', '),
          error: message,
        }),
      );
    }
  },
};
