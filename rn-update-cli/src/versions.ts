/**
 * [INPUT]: 依赖 Hermes bundle 摘要、对象上传、渠道版本组 API 与旧绑定 API
 * [OUTPUT]: 对外提供 full 发布、批量渠道组投放、逐构建 pdiff 登记、版本查询和兼容绑定命令，并上报 Hermes 校验结果
 * [POS]: CLI 发布编排层，独立服务按 (channel, packageVersion) 原子生成草稿并发布，pdiff 始终绑定精确 nativeVersion
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import chalk from 'chalk';
import { compare, satisfies } from 'compare-versions';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { doDelete, getAllPackages, post, put, uploadFile } from './api';
import { getPlatform, resolveAppId } from './app';
import { choosePackage } from './package';
import {
  publishStandalone,
  registerStandalonePdiff,
  retryStandalonePublish,
} from './standalone-publish';
import type { Package, Platform } from './types';
import { isNonInteractive, question } from './utils';
import { getDepVersions } from './utils/dep-versions';
import { getCommitInfo } from './utils/git';
import { sha256Hex } from './utils/hash';
import {
  BUNDLE_ENTRY_NAMES,
  cachePut,
  extractBundleFromArchive,
  type HermesBaseMeta,
  reportedBytecodeVersion,
  truncateHermesBaseDetail,
} from './utils/hermes-base';
import { isStandaloneService } from './utils/http-helper';
import { t } from './utils/i18n';
import { getBooleanOption, getStringListOption } from './utils/options';
import { packSourceMap } from './utils/slim-sourcemap';
import {
  bundleLocationFields,
  readZipEntryWithLocation,
} from './utils/zip-range';
import {
  bindVersionToPackages,
  chooseVersion,
  listVersions,
  printDepsChangesForPublish,
  toNumericIds,
} from './version-operations';

export interface VersionCommandOptions {
  [key: string]: unknown;
  config?: string;
  appKey?: string;
  appId?: string;
  name?: string;
  description?: string;
  metaInfo?: string;
  diffFromHash?: string;
  platform?: Platform;
  versionId?: string;
  versionIds?: string;
  packageId?: string;
  packageVersion?: string;
  channel?: string;
  targets?: string;
  deploymentIds?: string;
  releaseIds?: string;
  releaseId?: string;
  deploymentId?: string;
  nativeVersionId?: string;
  minPackageVersion?: string;
  maxPackageVersion?: string;
  packageVersionRange?: string;
  rollout?: number | string;
  dryRun?: boolean;
  sourcemap?: string;
  versionDeps?: Record<string, string>;
  warnDepsChanges?: boolean;
  /** internal: chain metadata from the bundle step (not a CLI flag) */
  hermesBase?: HermesBaseMeta;
  'no-interactive'?: boolean | string;
}

export {
  bindVersionToPackages,
  fetchVersions,
  findVersion,
  normalizeDeps,
} from './version-operations';

/**
 * Content identity of the ppk's bundle for the server (bundleHash, HBC version)
 * plus the base used to compile it, and a copy of the bundle in the local
 * cache so it can serve as a future base without a download.
 */
async function describePpkBundle(
  ppkPath: string,
  base?: HermesBaseMeta,
): Promise<Record<string, unknown>> {
  // Only known values are sent: the server's optional-field parsers treat an
  // explicit JSON null as invalid (that contract broke 2.22.0/2.22.1 publishes
  // with "Expected baseHash string"), and omitting a field is what every
  // server version — strict, tolerant or too old to know the field — accepts.
  const meta: Record<string, unknown> = {};
  try {
    // one pass over the ppk: the bundle itself plus where its compressed
    // bytes live, so the next build can fetch just them with one HTTP Range
    // request
    const found = ppkPath.toLowerCase().endsWith('.ppk')
      ? await readZipEntryWithLocation(ppkPath, (name) =>
          BUNDLE_ENTRY_NAMES.includes(name),
        ).catch(() => null)
      : null;
    const bundle = found?.data ?? (await extractBundleFromArchive(ppkPath));
    if (bundle) {
      const bundleHash = sha256Hex(bundle);
      meta.bundleHash = bundleHash;
      // 纯 JS bundle 上报 0：服务端据此绝不把它当作 Hermes base
      meta.bytecodeVersion = reportedBytecodeVersion(bundle);
      await cachePut(bundle, undefined, bundleHash).catch(() => {});
      Object.assign(meta, bundleLocationFields(found?.location));
    }
  } catch {
    // best effort: metadata never blocks a publish
  }
  if (base?.baseVersionId != null) meta.baseVersionId = base.baseVersionId;
  if (base?.baseHash) meta.baseHash = base.baseHash;
  if (base?.hermesBaseOutcome) meta.hermesBaseOutcome = base.hermesBaseOutcome;
  if (base?.hermesBaseDetail) {
    meta.hermesBaseDetail = truncateHermesBaseDetail(base.hermesBaseDetail);
  }
  return meta;
}

/** Exported for tests: the version/create fields derived from a ppk + base. */
export const describePpkBundleForTests = describePpkBundle;

export const versionCommands = {
  registerPdiff: async ({
    args,
    options,
  }: {
    args: string[];
    options: VersionCommandOptions;
  }) => {
    return registerStandalonePdiff(args[0] || '', options);
  },
  publish: async ({
    args,
    options,
  }: {
    args: string[];
    options: VersionCommandOptions;
  }) => {
    if (
      isStandaloneService() &&
      (options.deploymentIds || options.releaseIds)
    ) {
      const appId = await resolveAppId(options);
      return retryStandalonePublish(
        appId,
        String(options.deploymentIds || options.releaseIds),
        options.dryRun,
      );
    }
    const fn = args[0];
    const { name, description, metaInfo, diffFromHash, channel } = options;

    if (!fn?.endsWith('.ppk')) {
      throw new Error(t('publishUsage'));
    }

    if (isStandaloneService()) {
      // The Go service resolves the application directly from --appId. A
      // platform prompt is only needed by the legacy numeric service; keeping
      // it out of this branch makes CI publish/dry-run usable with targets.json
      // and an explicit app id.
      const appId = await resolveAppId(options);
      return publishStandalone(fn, appId, options);
    }
    const platform = await getPlatform(options.platform);
    const appId = await resolveAppId({ ...options, platform });
    const nonInteractive =
      getBooleanOption(options, 'no-interactive', false) || isNonInteractive();

    // The source map is archived with the version so `pakta symbolicate` can
    // map crashes back to source. An explicit path that does not exist is a
    // publish error; no path at all is a loud warning (custom pipelines that
    // never produced a map keep working).
    const sourcemapPath =
      typeof options.sourcemap === 'string' && options.sourcemap
        ? options.sourcemap
        : undefined;
    if (sourcemapPath && !fs.existsSync(sourcemapPath)) {
      throw new Error(t('sourceMapNotFound', { path: sourcemapPath }));
    }
    if (!sourcemapPath) {
      console.log(chalk.yellow(t('sourceMapMissingWarning')));
    }
    // Archive a slimmed, gzipped copy (see packSourceMap): relative paths, no
    // dependency sourcesContent, ~5x smaller on the wire. Frames keep
    // symbolicating everywhere; only inline snippets of node_modules code are
    // dropped. The temp file keeps the .map extension because /upload routes
    // by extension; readers detect gzip by magic bytes.
    let uploadSourcemapPath = sourcemapPath;
    let packTempDir: string | undefined;
    if (sourcemapPath) {
      packTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rnu-sourcemap-'));
      uploadSourcemapPath = path.join(
        packTempDir,
        path.basename(sourcemapPath),
      );
      fs.writeFileSync(
        uploadSourcemapPath,
        packSourceMap(fs.readFileSync(sourcemapPath, 'utf8'), process.cwd()),
      );
    }

    // Hashing/caching the bundle and asking git for the commit are independent
    // of the upload, so they overlap with it instead of running afterwards.
    // describePpkBundle never rejects (best effort); a failed upload still
    // fails the publish exactly as before.
    // A server that predates source-map archiving (self-hosted, or a SaaS
    // region not yet rolled) rejects the .map upload with 400; that must not
    // fail the publish, only lose the archive.
    let sourceMapUploadError: unknown;
    const [{ hash }, bundleMeta, commit, sourceMapUpload] = await Promise.all([
      uploadFile(fn, appId),
      describePpkBundle(fn, options.hermesBase),
      getCommitInfo(),
      uploadSourcemapPath
        ? uploadFile(uploadSourcemapPath, appId).catch((error: unknown) => {
            sourceMapUploadError = error;
            return undefined;
          })
        : Promise.resolve(undefined),
    ]).finally(() => {
      // the packed copy only exists for the upload; a failed ppk upload must
      // not leave it behind in the OS temp dir
      if (packTempDir) {
        fs.rmSync(packTempDir, { recursive: true, force: true });
      }
    });
    const sourceMapKey = sourceMapUpload?.hash;
    if (sourcemapPath && !sourceMapKey) {
      console.log(
        chalk.yellow(
          t('sourceMapUploadFailedWarning', {
            error:
              sourceMapUploadError instanceof Error
                ? sourceMapUploadError.message
                : String(sourceMapUploadError),
          }),
        ),
      );
    }
    const depVersions = getDepVersions();

    const versionName =
      name ||
      (nonInteractive ? '' : await question(t('versionNameQuestion'))) ||
      t('unnamed');
    const { id } = await post(`/app/${appId}/version/create`, {
      name: versionName,
      hash,
      description:
        description ??
        (nonInteractive ? '' : await question(t('versionDescriptionQuestion'))),
      metaInfo:
        metaInfo ??
        (nonInteractive ? '' : await question(t('versionMetaInfoQuestion'))),
      ...(diffFromHash ? { diffFromHash } : {}),
      deps: depVersions,
      commit,
      ...(channel ? { channel } : {}),
      // Hermes delta-mode chain metadata (old servers drop unknown fields)
      ...bundleMeta,
      // archived source map (old servers drop unknown fields)
      ...(sourceMapKey ? { sourceMapKey } : {}),
    });
    console.log(t('packageUploadSuccess', { id }));
    if (sourceMapKey) {
      console.log(t('sourceMapArchived', { id }));
    }

    const {
      packageId,
      packageVersion,
      packageVersionRange,
      minPackageVersion,
      maxPackageVersion,
      rollout,
      dryRun,
    } = options;

    if (
      packageId ||
      packageVersion ||
      packageVersionRange ||
      minPackageVersion ||
      maxPackageVersion
    ) {
      await versionCommands.update({
        options: {
          versionId: id,
          platform,
          appId,
          packageId,
          packageVersion,
          packageVersionRange,
          minPackageVersion,
          maxPackageVersion,
          rollout,
          channel,
          dryRun,
          versionDeps: depVersions,
          warnDepsChanges: true,
        },
      });
    } else if (!nonInteractive) {
      const q = await question(t('updateNativePackageQuestion'));
      if (q.toLowerCase() === 'y') {
        await versionCommands.update({
          options: {
            versionId: id,
            platform,
            appId,
            versionDeps: depVersions,
            warnDepsChanges: true,
          },
        });
      }
    }
    return versionName;
  },
  versions: async ({ options }: { options: VersionCommandOptions }) => {
    const appId = await resolveAppId(options);
    const interactive = !(
      getBooleanOption(options, 'no-interactive', false) || isNonInteractive()
    );
    await listVersions(appId, interactive);
  },
  update: async ({ options }: { options: VersionCommandOptions }) => {
    const nonInteractive =
      getBooleanOption(options, 'no-interactive', false) || isNonInteractive();
    const appId = await resolveAppId(options);

    let versionId: string | null | undefined = options.versionId;
    if (!versionId) {
      if (nonInteractive) {
        throw new Error(t('versionIdRequired'));
      }
      versionId = String((await chooseVersion(appId)).id);
    }
    if (versionId === 'null') {
      versionId = null;
    }

    let pkgId = options.packageId;
    let pkgVersion = options.packageVersion;
    let minPkgVersion = options.minPackageVersion;
    let maxPkgVersion = options.maxPackageVersion;
    let packageVersionRange = options.packageVersionRange;
    let rollout: number | undefined;

    if (options.rollout !== undefined) {
      rollout = Number.parseInt(String(options.rollout), 10);
      if (Number.isNaN(rollout) || rollout < 1 || rollout > 100) {
        throw new Error(t('rolloutRangeError'));
      }
    }

    const allPkgs = await getAllPackages(appId);

    if (!allPkgs) {
      throw new Error(t('noPackagesFound', { appId }));
    }

    const pkgMap = new Map(
      allPkgs.map((pkg: Package) => [String(pkg.id), pkg]),
    );

    let pkgsToBind: Package[] = [];

    const selectorGroups = [
      pkgId,
      pkgVersion,
      packageVersionRange,
      minPkgVersion || maxPkgVersion,
    ].filter(Boolean);
    if (selectorGroups.length > 1) {
      throw new Error(t('conflictingPackageSelectors'));
    }

    if (minPkgVersion || maxPkgVersion) {
      minPkgVersion = minPkgVersion && String(minPkgVersion).trim();
      maxPkgVersion = maxPkgVersion && String(maxPkgVersion).trim();
      pkgsToBind = allPkgs.filter((pkg: Package) => {
        const aboveMin =
          !minPkgVersion || compare(pkg.name, minPkgVersion, '>=');
        const belowMax =
          !maxPkgVersion || compare(pkg.name, maxPkgVersion, '<=');
        return aboveMin && belowMax;
      });
      if (pkgsToBind.length === 0) {
        if (minPkgVersion && maxPkgVersion) {
          throw new Error(
            t('nativeVersionNotFoundBetween', {
              min: minPkgVersion,
              max: maxPkgVersion,
            }),
          );
        }
        if (minPkgVersion) {
          throw new Error(
            t('nativeVersionNotFoundGte', { version: minPkgVersion }),
          );
        }
        throw new Error(
          t('nativeVersionNotFoundLte', { version: maxPkgVersion }),
        );
      }
    } else if (pkgVersion) {
      pkgVersion = pkgVersion.trim();
      const pkg = allPkgs.find((pkg: Package) => pkg.name === pkgVersion);
      if (pkg) {
        pkgsToBind = [pkg];
      } else {
        throw new Error(
          t('nativeVersionNotFoundMatch', { version: pkgVersion }),
        );
      }
    } else if (packageVersionRange) {
      packageVersionRange = packageVersionRange.trim();
      pkgsToBind = allPkgs.filter((pkg: Package) =>
        satisfies(pkg.name, packageVersionRange!),
      );
      if (pkgsToBind.length === 0) {
        throw new Error(
          t('nativeVersionNotFoundMatch', { version: packageVersionRange }),
        );
      }
    } else {
      if (!pkgId) {
        if (nonInteractive) {
          throw new Error(t('packageIdRequired'));
        }
        // the package list was already fetched above: no second round trip
        pkgId = String((await choosePackage(appId, allPkgs)).id);
      }

      if (!pkgId) {
        throw new Error(t('packageIdRequired'));
      }
      const pkg = pkgMap.get(String(pkgId));
      if (pkg) {
        pkgsToBind = [pkg];
      } else {
        throw new Error(t('nativePackageIdNotFound', { id: pkgId }));
      }
    }

    if (options.warnDepsChanges && versionId) {
      await printDepsChangesForPublish({
        appId,
        versionId: String(versionId),
        pkgs: pkgsToBind,
        providedVersionDeps: options.versionDeps,
      });
    }

    await bindVersionToPackages({
      appId,
      // keep null as-is: `--versionId null` means unbinding the version
      versionId: versionId ?? null,
      pkgs: pkgsToBind,
      rollout,
      dryRun: options.dryRun,
    });
  },
  updateVersionInfo: async ({
    options,
  }: {
    options: VersionCommandOptions;
  }) => {
    const nonInteractive =
      getBooleanOption(options, 'no-interactive', false) || isNonInteractive();
    const appId = await resolveAppId(options);

    let versionId = options.versionId;
    if (!versionId) {
      if (nonInteractive) {
        throw new Error(t('versionIdRequired'));
      }
      versionId = String((await chooseVersion(appId)).id);
    }

    const updateParams: Record<string, string> = {};
    if (options.name) updateParams.name = options.name;
    if (options.description) updateParams.description = options.description;
    if (options.metaInfo) updateParams.metaInfo = options.metaInfo;

    await put(`/app/${appId}/version/${versionId}`, updateParams);
    console.log(t('operationSuccess'));
  },
  deleteVersion: async ({ options }: { options: VersionCommandOptions }) => {
    const nonInteractive =
      getBooleanOption(options, 'no-interactive', false) || isNonInteractive();
    const appId = await resolveAppId(options);

    const parsedVersionIds =
      getStringListOption(options, 'versionIds') ??
      getStringListOption(options, 'versionId');
    let versionIds = parsedVersionIds;
    if (!versionIds) {
      if (nonInteractive) {
        throw new Error(t('versionIdRequired'));
      }
      versionIds = [String((await chooseVersion(appId)).id)];
    }

    try {
      if (versionIds.length === 1) {
        const [versionId] = versionIds;
        await doDelete(`/app/${appId}/version/${versionId}`);
        console.log(t('deleteVersionSuccess', { versionId }));
      } else {
        await doDelete(`/app/${appId}/version`, {
          versionIds: toNumericIds(versionIds),
        });
        console.log(
          t('deleteVersionsSuccess', {
            count: versionIds.length,
            versionIds: versionIds.join(', '),
          }),
        );
      }
    } catch (error: any) {
      throw new Error(
        t('deleteVersionError', {
          versionId: versionIds.join(', '),
          error: error.message,
        }),
      );
    }
  },
};
