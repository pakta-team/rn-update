/**
 * [INPUT]: 依赖独立 Go API、对象上传、渠道/原生包查询、hash.sha256File 流式制品指纹与 sha256Hex 幂等键、版本参数契约与本地化文案
 * [OUTPUT]: 对外提供 UpdatePackage/Deployment 上传（含受热更配额校验的 source map 归档）、默认 100% 全量的交互或显式目标解析、准确 ID 重试及逐构建 pdiff 登记
 * [POS]: CLI 独立服务投放编排层；一个包可在多个渠道×原生版本目标上原子保存并发布
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import chalk from 'chalk';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  get,
  getAllPackages,
  getChannels,
  post,
  put,
  servicePath,
  unwrapData,
  uploadFile,
} from './api';
import {
  assertChannelCreatable,
  findChannel,
  getOrCreateChannel,
  resolveAppId,
} from './app';
import { choosePackage } from './package';
import type { Package } from './types';
import { isNonInteractive, question } from './utils';
import { sha256File, sha256Hex } from './utils/hash';
import {
  type HermesBaseMeta,
  truncateHermesBaseDetail,
} from './utils/hermes-base';
import { isStandaloneService } from './utils/http-helper';
import { t } from './utils/i18n';
import { getBooleanOption } from './utils/options';
import { packSourceMap } from './utils/slim-sourcemap';
import type { VersionCommandOptions } from './versions';

type StandalonePublishTarget = {
  channelId: string;
  packageVersion: string;
  rollout: number;
};

type StandaloneDeployment = {
  id: string;
  packageId: string;
  channelId: string;
  packageVersion: string;
  rollout: number;
  forceBoot: boolean;
  revision: number;
};

const DEFAULT_STANDALONE_ROLLOUT = 100;

function hasStandaloneTargetSelection(options: VersionCommandOptions): boolean {
  return Boolean(
    options.targets ||
      options.packageId ||
      options.packageVersion ||
      options.packageVersionRange ||
      options.minPackageVersion ||
      options.maxPackageVersion,
  );
}

function resolveTargetRollout(value: unknown): number {
  const rollout =
    value === undefined ? DEFAULT_STANDALONE_ROLLOUT : Number(value);
  if (!Number.isInteger(rollout) || rollout < 1 || rollout > 100) {
    throw new Error(t('rolloutRangeError'));
  }
  return rollout;
}

function nativePackageVersion(pkg: Package): string {
  return String(pkg.versionName ?? pkg.name ?? '').trim();
}

/** Choose the native build that receives an interactively published package. */
async function chooseStandaloneTarget(
  appId: string,
  options: VersionCommandOptions,
): Promise<StandalonePublishTarget> {
  const channels = await getChannels(appId);
  const allPackages = (await getAllPackages(appId)) ?? [];
  const requestedChannel = String(options.channel || '').trim();
  let packages = allPackages;

  if (requestedChannel) {
    const channel =
      channels.find((item) => item.id === requestedChannel) ??
      findChannel(channels, requestedChannel);
    if (!channel) {
      throw new Error(t('channelNotRegistered', { channel: requestedChannel }));
    }
    packages = allPackages.filter((pkg) => pkg.channelId === channel.id);
  }

  if (packages.length === 0) {
    throw new Error(
      requestedChannel
        ? t('channelHasNoNativePackages', { channel: requestedChannel })
        : t('noPackagesFound', { appId }),
    );
  }

  const channelNames = new Map(
    channels.map((channel) => [channel.id, channel.code]),
  );
  const displayPackages = packages.map((pkg) => ({
    ...pkg,
    channel: pkg.channel || channelNames.get(pkg.channelId || ''),
  }));
  const selected = await choosePackage(appId, displayPackages);
  const channelId = String(selected.channelId || '').trim();
  const packageVersion = nativePackageVersion(selected);
  if (!channelId || !packageVersion) {
    throw new Error(t('nativePackageTargetMissingInfo'));
  }

  return {
    channelId,
    packageVersion,
    rollout: resolveTargetRollout(options.rollout),
  };
}

function standaloneOperationKey(
  appId: string,
  packageId: string,
  deploymentIds: string[],
) {
  const identity = [appId, packageId, ...deploymentIds].sort().join('\x00');
  return `cli-${sha256Hex(Buffer.from(identity)).slice(0, 64)}`;
}

function standaloneDraftOperationKey(
  appId: string,
  packageId: string,
  targets: StandalonePublishTarget[],
) {
  const identity = [
    appId,
    packageId,
    'save',
    ...targets
      .map(
        (target) =>
          `${target.channelId}\x00${target.packageVersion}\x00${target.rollout}`,
      )
      .sort(),
  ].join('\x00');
  return `cli-${sha256Hex(Buffer.from(identity)).slice(0, 64)}`;
}

/** Keep Hermes verification fields separate from the user's opaque metaInfo. */
function standaloneHermesOutcomeFields(
  value: HermesBaseMeta | undefined,
): Record<string, string> {
  if (!value?.hermesBaseOutcome) return {};
  const fields: Record<string, string> = {
    hermesBaseOutcome: value.hermesBaseOutcome,
  };
  const detail = truncateHermesBaseDetail(value.hermesBaseDetail);
  if (detail) fields.hermesBaseDetail = detail;
  return fields;
}

async function findStandalonePackageByHash(appId: string, hash: string) {
  const pageSize = 100;
  for (let page = 1; ; page += 1) {
    const response = await get(
      servicePath(
        `/apps/${encodeURIComponent(appId)}/update-packages?page=${page}&pageSize=${pageSize}`,
      ),
    );
    const result = unwrapData<{
      items?: Array<{ id: string; hash: string }>;
      total?: number;
    }>(response);
    const existing = result.items?.find((item) => item.hash === hash);
    if (existing) return existing;
    if (
      !result.items?.length ||
      (result.total !== undefined && page * pageSize >= result.total)
    ) {
      return undefined;
    }
  }
}

/** Convert CLI channel codes/targets into UUID targets used by the Go API. */
async function resolveStandaloneTargets(
  appId: string,
  options: VersionCommandOptions,
  dryRun = false,
): Promise<StandalonePublishTarget[]> {
  const channels = await getChannels(appId);
  const byId = new Map(channels.map((channel) => [channel.id, channel]));
  let rawTargets: Array<{
    channel?: string;
    channelId?: string;
    packageVersion?: string;
    rollout?: number | string;
  }>;
  if (options.targets) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(String(options.targets), 'utf8'));
    } catch (error) {
      throw new Error(
        t('targetsFileReadFailed', {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    const candidate = Array.isArray(parsed)
      ? parsed
      : parsed &&
          typeof parsed === 'object' &&
          Array.isArray((parsed as any).targets)
        ? (parsed as any).targets
        : null;
    if (!candidate) {
      throw new Error(t('targetsFileInvalid'));
    }
    rawTargets = candidate as typeof rawTargets;
  } else if (options.packageId) {
    const packages = (await getAllPackages(appId)) ?? [];
    const selected = packages.find(
      (pkg) => String(pkg.id) === String(options.packageId),
    );
    if (!selected) {
      throw new Error(t('nativePackageIdNotFound', { id: options.packageId }));
    }
    const packageVersion = nativePackageVersion(selected);
    if (!selected.channelId || !packageVersion) {
      throw new Error(t('specifiedNativePackageTargetMissingInfo'));
    }
    rawTargets = [
      {
        channelId: selected.channelId,
        packageVersion,
      },
    ];
  } else {
    rawTargets = [
      {
        channel: options.channel || 'default',
        packageVersion: options.packageVersion,
      },
    ];
  }
  if (rawTargets.length === 0) {
    throw new Error(t('targetsRequired'));
  }
  const planned = rawTargets.map((target) => {
    const rawChannel = target.channel || options.channel || 'default';
    const channel = target.channelId
      ? byId.get(target.channelId)
      : findChannel(channels, rawChannel);
    if (!channel && (target.channelId || dryRun)) {
      throw new Error(
        t('channelNotRegistered', {
          channel:
            target.channelId || target.channel || options.channel || 'default',
        }),
      );
    }
    const packageVersion = String(
      target.packageVersion || options.packageVersion || '',
    ).trim();
    if (!packageVersion) {
      throw new Error(t('standalonePackageVersionRequired'));
    }
    const targetRollout = resolveTargetRollout(
      target.rollout === undefined ? options.rollout : target.rollout,
    );
    if (!channel) assertChannelCreatable(rawChannel);
    return { channel, rawChannel, packageVersion, rollout: targetRollout };
  });
  const targets: StandalonePublishTarget[] = [];
  for (const target of planned) {
    const resolved = target.channel
      ? { channel: target.channel, created: false }
      : await getOrCreateChannel(appId, target.rawChannel);
    if (resolved.created) {
      console.log(t('channelAutoCreated', { channel: resolved.channel.code }));
    }
    targets.push({
      channelId: resolved.channel.id,
      packageVersion: target.packageVersion,
      rollout: target.rollout,
    });
  }
  return targets;
}

export async function publishStandalone(
  fn: string,
  appId: string,
  options: VersionCommandOptions,
): Promise<string> {
  const nonInteractive =
    getBooleanOption(options, 'no-interactive', false) || isNonInteractive();
  const hasExplicitTargets = hasStandaloneTargetSelection(options);
  if (!hasExplicitTargets && options.channel) {
    const channels = await getChannels(appId);
    if (!channels.some((channel) => channel.id === options.channel)) {
      findChannel(channels, options.channel);
    }
  }
  let targets: StandalonePublishTarget[] | undefined;
  if (hasExplicitTargets || options.dryRun) {
    targets = await resolveStandaloneTargets(
      appId,
      options,
      Boolean(options.dryRun),
    );
  } else if (nonInteractive) {
    throw new Error(t('standaloneTargetRequired'));
  }

  if (options.dryRun) {
    console.log(JSON.stringify({ appId, targets, dryRun: true }, null, 2));
    return String(options.name || 'dry-run');
  }

  const hash = await sha256File(fn);
  const sourcemapPath =
    typeof options.sourcemap === 'string' && options.sourcemap.trim()
      ? options.sourcemap.trim()
      : undefined;
  if (sourcemapPath && !fs.existsSync(sourcemapPath)) {
    throw new Error(t('sourceMapNotFound', { path: sourcemapPath }));
  }
  // Source maps are hot-update artifacts. Pack the map before upload so the
  // server checks the bytes that will actually be archived, while retaining
  // the CLI's relative-path/sourceContent slimming contract.
  let uploadSourcemapPath = sourcemapPath;
  let packTempDir: string | undefined;
  if (sourcemapPath) {
    packTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rnu-sourcemap-'));
    uploadSourcemapPath = path.join(packTempDir, path.basename(sourcemapPath));
    fs.writeFileSync(
      uploadSourcemapPath,
      packSourceMap(fs.readFileSync(sourcemapPath, 'utf8'), process.cwd()),
    );
  }
  let packageValue: { id: string };
  let createdNewPackage = false;
  const existing = await findStandalonePackageByHash(appId, hash);
  if (existing) {
    packageValue = existing;
    if (uploadSourcemapPath) {
      console.log(chalk.yellow(t('sourceMapAlreadyArchivedWarning')));
    }
    if (packTempDir) {
      fs.rmSync(packTempDir, { recursive: true, force: true });
    }
  } else {
    const name =
      options.name ||
      (nonInteractive ? '' : await question(t('versionNameQuestion'))) ||
      t('unnamed');
    const description =
      options.description ??
      (nonInteractive ? '' : await question(t('versionDescriptionQuestion')));
    const metaInfo =
      options.metaInfo ??
      (nonInteractive ? '' : await question(t('versionMetaInfoQuestion')));
    try {
      const [uploaded, sourceMapUpload] = await Promise.all([
        uploadFile(fn, appId),
        uploadSourcemapPath
          ? uploadFile(uploadSourcemapPath, appId)
          : Promise.resolve(undefined),
      ]);
      const fullKey = uploaded.key || uploaded.hash;
      const sourceMapKey = sourceMapUpload?.key || sourceMapUpload?.hash;
      const response = await post(
        servicePath(`/apps/${encodeURIComponent(appId)}/update-packages`),
        {
          name,
          hash,
          description,
          metaInfo,
          ...standaloneHermesOutcomeFields(options.hermesBase),
          diffVersion: 0,
          ...(options.diffFromHash
            ? { diffFromHash: options.diffFromHash }
            : {}),
          fullKey,
          diffKey: '',
          pdiffKey: '',
          ...(sourceMapKey ? { sourceMapKey } : {}),
        },
      );
      packageValue = unwrapData<{ id: string }>(response);
      createdNewPackage = true;
    } catch (error) {
      const raced = await findStandalonePackageByHash(appId, hash);
      if (!raced) throw error;
      packageValue = raced;
    } finally {
      if (packTempDir) {
        fs.rmSync(packTempDir, { recursive: true, force: true });
      }
    }
  }

  if (!targets) {
    const bind = await question(t('updateNativePackageQuestion'));
    if (bind.toLowerCase() !== 'y') {
      if (createdNewPackage) {
        console.log(t('packageUploadSuccess', { id: packageValue.id }));
      }
      return packageValue.id;
    }
    targets = [await chooseStandaloneTarget(appId, options)];
  }

  const deploymentResponse = await get(
    servicePath(
      `/update-packages/${encodeURIComponent(packageValue.id)}/deployments`,
    ),
  );
  const existingDeployments =
    unwrapData<StandaloneDeployment[]>(deploymentResponse);
  const existingByTarget = new Map(
    existingDeployments.map((deployment) => [
      `${deployment.channelId}\x00${deployment.packageVersion}`,
      deployment,
    ]),
  );
  const duplicateTargets = new Set<string>();
  for (const target of targets) {
    const targetKey = `${target.channelId}\x00${target.packageVersion}`;
    if (duplicateTargets.has(targetKey)) {
      throw new Error(
        t('duplicateDeploymentTarget', {
          channelId: target.channelId,
          packageVersion: target.packageVersion,
        }),
      );
    }
    duplicateTargets.add(targetKey);
  }

  const missingTargets = targets.filter(
    (target) =>
      !existingByTarget.has(`${target.channelId}\x00${target.packageVersion}`),
  );
  const savedByTarget = new Map<string, StandaloneDeployment>();
  if (missingTargets.length > 0) {
    const draftIdempotencyKey = standaloneDraftOperationKey(
      appId,
      packageValue.id,
      missingTargets,
    );
    const response = await post(
      servicePath(`/apps/${encodeURIComponent(appId)}/deployments/batch`),
      {
        idempotencyKey: draftIdempotencyKey,
        commands: missingTargets.map((target) => ({
          packageId: packageValue.id,
          channelId: target.channelId,
          packageVersion: target.packageVersion,
          rollout: target.rollout,
          forceBoot: false,
          action: 'save',
        })),
      },
    );
    const saved = unwrapData<StandaloneDeployment[]>(response);
    for (const deployment of saved) {
      savedByTarget.set(
        `${deployment.channelId}\x00${deployment.packageVersion}`,
        deployment,
      );
    }
  }

  const created: Array<StandaloneDeployment & { rollout: number }> =
    targets.map((target) => {
      const targetKey = `${target.channelId}\x00${target.packageVersion}`;
      const deployment =
        existingByTarget.get(targetKey) || savedByTarget.get(targetKey);
      if (!deployment) {
        throw new Error(
          t('deploymentStrategyMissing', {
            channelId: target.channelId,
            packageVersion: target.packageVersion,
          }),
        );
      }
      return { ...deployment, ...target, packageId: packageValue.id };
    });
  const idempotencyKey = standaloneOperationKey(
    appId,
    packageValue.id,
    created.map((deployment) => deployment.id),
  );
  try {
    await post(
      servicePath(`/apps/${encodeURIComponent(appId)}/deployments/batch`),
      {
        idempotencyKey,
        commands: created.map((deployment) => ({
          id: deployment.id,
          packageId: packageValue.id,
          channelId: deployment.channelId,
          packageVersion: deployment.packageVersion,
          rollout: deployment.rollout,
          forceBoot: false,
          action: 'publish',
          expectedRevision: deployment.revision,
        })),
      },
    );
  } catch (error) {
    console.error(
      t('deploymentPublishFailed', {
        deploymentIds: created.map((deployment) => deployment.id).join(', '),
      }),
    );
    throw error;
  }
  console.log(
    JSON.stringify(
      {
        packageId: packageValue.id,
        deploymentIds: created.map((deployment) => deployment.id),
        idempotencyKey,
        targets,
      },
      null,
      2,
    ),
  );
  return packageValue.id;
}

/** Retry publishing deployments returned by a failed standalone publish.
 *
 * Retry uses exact deployment ids and revisions; no artifact upload or new
 * package is created.
 */
export async function retryStandalonePublish(
  appId: string,
  releaseIdsInput: string,
  dryRun = false,
): Promise<string> {
  const deploymentIds = releaseIdsInput
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (deploymentIds.length === 0) {
    throw new Error(t('deploymentIdsRequired'));
  }
  const deployments = await Promise.all(
    deploymentIds.map(async (deploymentId) => {
      const response = await get(
        servicePath(`/deployments/${encodeURIComponent(deploymentId)}`),
      );
      const deployment = unwrapData<{
        id: string;
        applicationId: string;
        packageId: string;
        channelId: string;
        packageVersion: string;
        rollout: number;
        forceBoot: boolean;
        revision: number;
      }>(response);
      if (
        !deployment ||
        deployment.applicationId !== appId ||
        !deployment.packageId ||
        !deployment.channelId ||
        !deployment.packageVersion
      ) {
        throw new Error(t('deploymentInvalid', { deploymentId, appId }));
      }
      return deployment;
    }),
  );
  const commands = deployments.map(
    ({
      id,
      packageId,
      channelId,
      packageVersion,
      rollout,
      forceBoot,
      revision,
    }) => ({
      id,
      packageId,
      channelId,
      packageVersion,
      rollout,
      forceBoot,
      expectedRevision: revision,
      action: 'publish',
    }),
  );
  const packageIds = [
    ...new Set(deployments.map((deployment) => deployment.packageId)),
  ];
  if (packageIds.length !== 1) {
    throw new Error(t('deploymentTargetsSinglePackage'));
  }
  const idempotencyKey = standaloneOperationKey(
    appId,
    packageIds[0],
    deploymentIds,
  );
  if (dryRun) {
    console.log(
      JSON.stringify(
        { appId, deploymentIds, idempotencyKey, commands, dryRun: true },
        null,
        2,
      ),
    );
    return deploymentIds.join(',');
  }
  await post(
    servicePath(`/apps/${encodeURIComponent(appId)}/deployments/batch`),
    { idempotencyKey, commands },
  );
  console.log(
    JSON.stringify(
      { deploymentIds, idempotencyKey, commands, retried: true },
      null,
      2,
    ),
  );
  return deploymentIds.join(',');
}

/**
 * Upload and register one native-package patch for one exact build.
 *
 * The server deliberately does not expose a group-wide pdiff field for this
 * command: a patch is only valid against the nativeVersionId it was built
 * from. A dry-run resolves local arguments but never uploads or mutates a
 * release mapping.
 */
export async function registerStandalonePdiff(
  filePath: string,
  options: VersionCommandOptions,
): Promise<string> {
  if (!isStandaloneService()) {
    throw new Error(t('pdiffServiceRequired'));
  }
  const deploymentId = String(
    options.deploymentId || options.releaseId || '',
  ).trim();
  const nativeVersionId = String(options.nativeVersionId || '').trim();
  const diffFromHash = String(options.diffFromHash || '')
    .trim()
    .toLowerCase();
  if (!deploymentId || !nativeVersionId || !diffFromHash) {
    throw new Error(t('pdiffArgumentsRequired'));
  }
  if (!/^[0-9a-f]{64}$/.test(diffFromHash)) {
    throw new Error(t('pdiffHashInvalid'));
  }
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(
      t('pdiffFileNotFound', { filePath: filePath || t('unspecified') }),
    );
  }
  const patchSuffixes = [
    '.apk.patch',
    '.ipa.patch',
    '.hap.patch',
    '.app.patch',
  ];
  if (
    !patchSuffixes.some((suffix) => filePath.toLowerCase().endsWith(suffix))
  ) {
    throw new Error(t('pdiffFileExtensionInvalid'));
  }
  const appId = await resolveAppId(options);
  if (options.dryRun) {
    const preview = {
      appId,
      deploymentId,
      nativeVersionId,
      diffFromHash,
      filePath,
      dryRun: true,
    };
    console.log(JSON.stringify(preview, null, 2));
    return deploymentId;
  }

  const uploaded = await uploadFile(filePath, appId);
  const key = uploaded.key || uploaded.hash;
  const response = await put(
    servicePath(
      `/deployments/${encodeURIComponent(deploymentId)}/pdiffs/${encodeURIComponent(nativeVersionId)}`,
    ),
    { diffFromHash, key },
  );
  const mapping = unwrapData<{ id?: string; key?: string }>(response);
  const result = {
    deploymentId,
    nativeVersionId,
    diffFromHash,
    key: mapping?.key || key,
    id: mapping?.id,
  };
  console.log(JSON.stringify(result, null, 2));
  return deploymentId;
}
