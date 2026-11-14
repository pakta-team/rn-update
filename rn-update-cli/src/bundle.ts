/**
 * [INPUT]: 依赖 CLI 参数/应用选择、Metro/Hermes bundle runner、PPK packer、版本 API 与本地构建工具
 * [OUTPUT]: 对外提供 bundleCommands 及标准化 bundle 选项/发布编排，并传递 Hermes 校验元数据
 * [POS]: CLI bundle 领域入口，串联打包、源码映射、Hermes base、应用绑定和版本发布，不实现底层压缩与网络协议
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import path from 'path';
import { AppNotSelectedError, getPlatform, resolveAppId } from './app';
import { packBundle } from './bundle-pack';
import {
  copyDebugidForSentry,
  runReactNativeBundleCommand,
  type SentryUploadOptions,
  uploadSourcemapForSentry,
} from './bundle-runner';
import type { Platform } from './types';
import { checkPlugins, question, translateOptions } from './utils';
import { addGitIgnore } from './utils/add-gitignore';
import { checkLockFiles } from './utils/check-lockfile';
import { tempDir } from './utils/constants';
import { getDepVersions } from './utils/dep-versions';
import {
  cleanStaleTmp,
  type HermesBaseMeta,
  hermesBaseMeta,
} from './utils/hermes-base';
import { t } from './utils/i18n';
import {
  getBooleanOption,
  getOptionalStringOption,
  getStringOption,
} from './utils/options';
import { versionCommands } from './versions';

type NormalizedBundleOptions = {
  bundleName: string;
  entryFile: string;
  intermediaDir: string;
  output: string;
  dev: string;
  sourcemap: boolean;
  taro: boolean;
  expo: boolean;
  rncli: boolean;
  hermes: boolean;
  hermesBase: string;
  verifyHermesBase: boolean;
  resetCache: boolean;
  cacheMaxMb?: number;
  appId?: string;
  config?: string;
  name?: string;
  description?: string;
  metaInfo?: string;
  packageId?: string;
  packageVersion?: string;
  minPackageVersion?: string;
  maxPackageVersion?: string;
  packageVersionRange?: string;
  rollout?: string;
  dryRun: boolean;
  sentryRelease?: string;
  sentryDist?: string;
};

/** `--no-<flag>` as parsed by cli-arguments: the key is present without a value. */
function isClearedFlag(options: Record<string, unknown>, key: string): boolean {
  return key in options && options[key] === undefined;
}

/** Parse a positive cache-size option expressed in megabytes. */
function parseCacheMaxMb(value: unknown): number | undefined {
  const parsed = typeof value === 'string' ? Number(value) : (value as number);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

type PublishBundlePayload = {
  appId: string;
  name?: string;
  description?: string;
  metaInfo?: string;
  packageId?: string;
  packageVersion?: string;
  minPackageVersion?: string;
  maxPackageVersion?: string;
  packageVersionRange?: string;
  rollout?: string;
  dryRun?: boolean;
  hermesBase?: HermesBaseMeta;
  /** path of the final source map to archive with the version */
  sourcemap?: string;
};

/** Read either spelling of an aliased optional CLI string option. */
function getAliasedOptionalStringOption(
  options: Record<string, unknown>,
  key: string,
  alias: string,
): string | undefined {
  return (
    getOptionalStringOption(options, key) ??
    getOptionalStringOption(options, alias)
  );
}

/** Normalize translated CLI values into the bundle command's typed options. */
export function normalizeBundleOptions(
  translatedOptions: Record<string, unknown>,
  platform: string,
): NormalizedBundleOptions {
  return {
    // harmony bundles always use this fixed name (runReactNativeBundleCommand
    // forces it), so sourcemap paths and Sentry uploads must match
    bundleName:
      platform === 'harmony'
        ? 'bundle.harmony.js'
        : getStringOption(translatedOptions, 'bundleName', 'index.bundlejs'),
    entryFile: getStringOption(translatedOptions, 'entryFile', 'index.js'),
    intermediaDir: getStringOption(
      translatedOptions,
      'intermediaDir',
      `${tempDir}/intermedia/${platform}`,
    ),
    output: getStringOption(
      translatedOptions,
      'output',
      `${tempDir}/output/${platform}.\${time}.ppk`,
    ),
    dev: getBooleanOption(translatedOptions, 'dev', false) ? 'true' : 'false',
    // On by default since 2.23: the map is archived with the published
    // version (pakta symbolicate). `--no-sourcemap` opts out: cli-arguments
    // implements `--no-<flag>` by clearing the flag's value, so a key that is
    // present but undefined is the opt-out and only a missing key means
    // "default" (`--sourcemap false` would leave the flag on, see `bundle`).
    sourcemap: isClearedFlag(translatedOptions, 'sourcemap')
      ? false
      : getBooleanOption(translatedOptions, 'sourcemap', true),
    taro: getBooleanOption(translatedOptions, 'taro', false),
    expo: getBooleanOption(translatedOptions, 'expo', false),
    rncli: getBooleanOption(translatedOptions, 'rncli', false),
    hermes: getBooleanOption(translatedOptions, 'hermes', false),
    hermesBase: getStringOption(translatedOptions, 'hermesBase', 'auto'),
    verifyHermesBase: getBooleanOption(
      translatedOptions,
      'verifyHermesBase',
      true,
    ),
    resetCache: getBooleanOption(translatedOptions, 'resetCache', true),
    cacheMaxMb: parseCacheMaxMb(translatedOptions.cacheMaxMb),
    appId: getOptionalStringOption(translatedOptions, 'appId'),
    config: getOptionalStringOption(translatedOptions, 'config'),
    name: getOptionalStringOption(translatedOptions, 'name'),
    description: getOptionalStringOption(translatedOptions, 'description'),
    metaInfo: getOptionalStringOption(translatedOptions, 'metaInfo'),
    packageId: getOptionalStringOption(translatedOptions, 'packageId'),
    packageVersion: getOptionalStringOption(
      translatedOptions,
      'packageVersion',
    ),
    minPackageVersion: getOptionalStringOption(
      translatedOptions,
      'minPackageVersion',
    ),
    maxPackageVersion: getOptionalStringOption(
      translatedOptions,
      'maxPackageVersion',
    ),
    packageVersionRange: getOptionalStringOption(
      translatedOptions,
      'packageVersionRange',
    ),
    rollout: getOptionalStringOption(translatedOptions, 'rollout'),
    dryRun: getBooleanOption(translatedOptions, 'dryRun', false),
    sentryRelease: getAliasedOptionalStringOption(
      translatedOptions,
      'sentry-release',
      'sentryRelease',
    ),
    sentryDist: getAliasedOptionalStringOption(
      translatedOptions,
      'sentry-dist',
      'sentryDist',
    ),
  };
}

/** Upload generated Sentry artifacts when the detected plugin requires them. */
async function uploadSentryArtifactsIfNeeded(
  shouldUpload: boolean,
  bundleName: string,
  intermediaDir: string,
  sourcemapOutput: string,
  platform: Platform,
  sentryOptions: SentryUploadOptions,
): Promise<void> {
  if (!shouldUpload) {
    return;
  }

  await copyDebugidForSentry(bundleName, intermediaDir, sourcemapOutput);
  await uploadSourcemapForSentry(
    bundleName,
    intermediaDir,
    sourcemapOutput,
    platform,
    sentryOptions,
  );
}

/** Publish a packed bundle through the version command implementation. */
async function publishBundleVersion(
  outputPath: string,
  platform: Platform,
  payload: PublishBundlePayload,
): Promise<string> {
  return versionCommands.publish({
    args: [outputPath],
    options: {
      platform,
      ...payload,
    },
  });
}

export const bundleCommands = {
  /** Build a bundle and optionally publish it to one operation-scoped app. */
  bundle: async ({
    args = [],
    options,
  }: {
    args?: string[];
    options: Record<string, unknown>;
  }) => {
    // Boolean flags take no value: `--sourcemap false` leaves the flag on and
    // turns "false" into a stray argument. Refuse it rather than silently
    // bundling with the wrong settings (a flag is switched off with
    // `--no-<flag>`).
    if (args.length > 0) {
      throw new Error(t('bundleUnexpectedArgs', { args: args.join(' ') }));
    }
    const platform = await getPlatform(
      typeof options.platform === 'string' ? options.platform : undefined,
    );

    const translatedOptions = translateOptions({
      ...options,
      tempDir,
      platform,
    });
    const normalized = normalizeBundleOptions(translatedOptions, platform);

    // One app per operation: the Hermes base lookup and the publish step must
    // never see different apps, so the target is resolved once and reused.
    let appId: string | undefined;
    const getAppId = async () =>
      (appId ??= await resolveAppId({
        appId: normalized.appId,
        config: normalized.config,
        platform,
      }));
    const hermesBase =
      normalized.dev === 'true'
        ? undefined
        : {
            option: normalized.hermesBase,
            verify: normalized.verifyHermesBase,
            cacheMaxMb: normalized.cacheMaxMb,
          };

    // Resolve before any side effect or expensive work. A named bundle is
    // published, so a missing app fails right here; a bundle-only run only
    // needs the app for the remote Hermes base lookup and may go on without
    // one (it then compiles a full bundle). Any other config error (e.g.
    // malformed JSON) is reported immediately either way.
    if (normalized.name) {
      await getAppId();
    } else if (hermesBase?.option === 'auto') {
      try {
        await getAppId();
      } catch (error) {
        if (!(error instanceof AppNotSelectedError)) {
          throw error;
        }
      }
    }

    checkLockFiles();
    addGitIgnore();

    const [bundleParams] = await Promise.all([
      checkPlugins(),
      cleanStaleTmp().catch(() => {}),
    ]);
    const sourcemapOutput = path.join(
      normalized.intermediaDir,
      `${normalized.bundleName}.map`,
    );
    const realOutput = normalized.output.replace(
      /\$\{time\}/g,
      `${Date.now()}`,
    );

    console.log(
      t('bundlingWithRN', { version: getDepVersions()['react-native'] }),
    );

    const hermesResult = await runReactNativeBundleCommand({
      bundleName: normalized.bundleName,
      dev: normalized.dev,
      entryFile: normalized.entryFile,
      outputFolder: normalized.intermediaDir,
      platform,
      sourcemapOutput:
        normalized.sourcemap || bundleParams.sourcemap ? sourcemapOutput : '',
      forceHermes: normalized.hermes,
      hermesBase: hermesBase ? { ...hermesBase, appId } : undefined,
      resetCache: normalized.resetCache,
      cli: {
        taro: normalized.taro,
        expo: normalized.expo,
        rncli: normalized.rncli,
      },
      isSentry: bundleParams.sentry,
    });

    await packBundle(
      path.resolve(normalized.intermediaDir),
      realOutput,
      normalized.bundleName,
    );
    const baseMeta = hermesResult
      ? hermesBaseMeta(hermesResult.base, hermesResult.bytecodeVersion, {
          outcome: hermesResult.outcome,
          detail: hermesResult.outcomeDetail,
        })
      : undefined;

    if (normalized.name) {
      await publishBundleVersion(realOutput, platform, {
        appId: await getAppId(),
        name: normalized.name,
        description: normalized.description,
        metaInfo: normalized.metaInfo,
        packageId: normalized.packageId,
        packageVersion: normalized.packageVersion,
        minPackageVersion: normalized.minPackageVersion,
        maxPackageVersion: normalized.maxPackageVersion,
        packageVersionRange: normalized.packageVersionRange,
        rollout: normalized.rollout,
        dryRun: normalized.dryRun,
        hermesBase: baseMeta,
        sourcemap:
          normalized.sourcemap || bundleParams.sourcemap
            ? sourcemapOutput
            : undefined,
      });
      await uploadSentryArtifactsIfNeeded(
        bundleParams.sentry,
        normalized.bundleName,
        normalized.intermediaDir,
        sourcemapOutput,
        platform,
        {
          sentryRelease: normalized.sentryRelease,
          sentryDist: normalized.sentryDist,
        },
      );
      return;
    }

    if (!getBooleanOption(options, 'no-interactive', false)) {
      const v = await question(t('uploadBundlePrompt'));
      if (v.toLowerCase() === 'y') {
        await publishBundleVersion(realOutput, platform, {
          appId: await getAppId(),
          hermesBase: baseMeta,
          sourcemap:
            normalized.sourcemap || bundleParams.sourcemap
              ? sourcemapOutput
              : undefined,
        });
        await uploadSentryArtifactsIfNeeded(
          bundleParams.sentry,
          normalized.bundleName,
          normalized.intermediaDir,
          sourcemapOutput,
          platform,
          {
            sentryRelease: normalized.sentryRelease,
            sentryDist: normalized.sentryDist,
          },
        );
      }
    }
  },
};
