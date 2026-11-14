/**
 * [INPUT]: 依赖 CLI API、update.json 配置、平台交互提示与本地化文案
 * [OUTPUT]: 对外提供应用选择、应用 CRUD、独立服务渠道 CRUD 与缺失渠道幂等创建
 * [POS]: CLI 目标解析层，负责把平台/应用/渠道身份收敛为服务端 UUID，并为发布命令补齐渠道
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from 'fs';
import type { ServiceChannel } from './api';
import {
  createChannel,
  doDelete,
  get,
  getChannels,
  post,
  put,
  servicePath,
  unwrapData,
} from './api';
import type { Platform } from './types';
import { isNonInteractive, loadTtyTable, question } from './utils';
import { updateJson } from './utils/constants';
import { isStandaloneService } from './utils/http-helper';
import { t } from './utils/i18n';

interface AppSummary {
  id: string | number;
  name: string;
  platform: Platform;
}

export interface AppTargetOptions {
  appId?: string;
  config?: string;
  platform?: Platform | '';
}

export interface ResolvedChannel {
  channel: ServiceChannel;
  created: boolean;
}

/** The selected-app config file was missing or has no entry for the platform. */
export class AppNotSelectedError extends Error {
  readonly code = 'APP_NOT_SELECTED';
  constructor(platform: Platform) {
    super(t('appNotSelected', { platform }));
    this.name = 'AppNotSelectedError';
  }
}

/** Resolve an explicit platform or prompt for one interactively. */
export async function getPlatform(platform?: string) {
  return assertPlatform(
    platform || (await question(t('platformQuestion'))),
  ) as Platform;
}

/** Validate that a string names a platform supported by the update service. */
export function assertPlatform(platform: string): Platform {
  if (platform !== 'ios' && platform !== 'android' && platform !== 'harmony') {
    throw new Error(t('unsupportedPlatform', { platform }));
  }
  return platform as Platform;
}

/** Parse a legacy positive integer or an RFC 9562 UUID used by standalone services. */
function parseAppId(value: string): string {
  if (
    isStandaloneService() &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    return value;
  }
  const id = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(id)) {
    throw new Error(t('invalidId', { id: value }));
  }
  return String(id);
}

type UpdateInfo = Partial<
  Record<Platform, { appId: number | string; appKey: string }>
>;

/** The parsed config file, or undefined when it does not exist. */
async function readUpdateInfo(
  configPath: string,
): Promise<UpdateInfo | undefined> {
  let raw: string;
  try {
    raw = await fs.promises.readFile(configPath, 'utf8');
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      return undefined;
    }
    throw e;
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(t('failedToParseUpdateJson', { configPath }));
  }
}

/** Read the selected app for a platform from the requested config file. */
export async function getSelectedApp(
  platform: Platform,
  configPath?: string,
): Promise<{ appId: string; appKey: string; platform: Platform }> {
  assertPlatform(platform);

  const updateInfo = await readUpdateInfo(configPath || updateJson);
  const info = updateInfo?.[platform];
  if (!info) {
    throw new AppNotSelectedError(platform);
  }
  return {
    appId: String(info.appId),
    appKey: info.appKey,
    platform,
  };
}

/** Resolve a standalone channel and create it on first use when absent. */
export function findChannel(
  channels: ServiceChannel[],
  code: string,
): ServiceChannel | undefined {
  const requestedCode = code.trim();
  if (!requestedCode) throw new Error(t('channelCodeRequired'));
  const exact = channels.filter((channel) => channel.code === requestedCode);
  const matches = exact.length
    ? exact
    : channels.filter(
        (channel) => channel.code.toLowerCase() === requestedCode.toLowerCase(),
      );
  if (matches.length > 1) {
    throw new Error(t('channelAmbiguous', { channel: requestedCode }));
  }
  return matches[0];
}

export function assertChannelCreatable(code: string): void {
  if (!code.trim()) throw new Error(t('channelCodeRequired'));
  if (code.trim() !== code.trim().toLowerCase()) {
    throw new Error(t('channelIdentityCannotCreate', { channel: code.trim() }));
  }
}

export async function getOrCreateChannel(
  appId: string,
  code: string,
): Promise<ResolvedChannel> {
  const normalizedCode = code.trim();
  const existing = findChannel(await getChannels(appId), normalizedCode);
  if (existing) {
    return { channel: existing, created: false };
  }
  assertChannelCreatable(normalizedCode);

  try {
    return {
      channel: await createChannel(appId, normalizedCode, normalizedCode),
      created: true,
    };
  } catch (error) {
    let channels: ServiceChannel[];
    try {
      channels = await getChannels(appId);
    } catch {
      throw error;
    }
    const concurrent = findChannel(channels, normalizedCode);
    if (concurrent) {
      return { channel: concurrent, created: false };
    }
    throw error;
  }
}

/**
 * Fail fast when an explicit `--appId` names an app of another platform.
 * The server accepts a bundle for any app the account owns and never sees
 * the platform it was built for, so this is the only place the mistake can
 * be caught before it reaches devices. A missing or foreign app fails here
 * too (403/404) instead of after the expensive work.
 */
async function assertAppPlatform(appId: string, platform: Platform) {
  const app = unwrapData<{ platform?: Platform; appKey?: unknown }>(
    await get(
      isStandaloneService()
        ? servicePath(`/apps/${encodeURIComponent(appId)}`)
        : `/app/${appId}`,
    ),
  );
  if (app.platform && app.platform !== platform) {
    throw new Error(
      t('appPlatformMismatch', { appId, appPlatform: app.platform, platform }),
    );
  }
  return app;
}

/**
 * Resolve the app an operation targets: an explicit `--appId` wins, otherwise
 * the app selected for the platform in `--config` (default: update.json).
 * Prompts for the platform only when it is needed and not given.
 */
export async function resolveAppId(
  options: AppTargetOptions = {},
): Promise<string> {
  if (options.platform) {
    assertPlatform(options.platform);
  }
  if (options.appId) {
    const appId = String(options.appId);
    if (options.platform) {
      await assertAppPlatform(appId, options.platform);
    }
    return appId;
  }
  const platform = await getPlatform(options.platform || undefined);
  return (await getSelectedApp(platform, options.config)).appId;
}

/** List apps, optionally filtering them to one platform. */
export async function listApp(platform: Platform | '' = '') {
  const response = await get(
    isStandaloneService()
      ? servicePath('/apps?page=1&pageSize=100')
      : '/app/list',
  );
  const page = unwrapData<{ items?: AppSummary[] }>(response);
  const allApps = isStandaloneService()
    ? (page?.items ?? [])
    : ((response as { data?: AppSummary[] })?.data ?? []);
  const list = platform
    ? allApps.filter((app: AppSummary) => app.platform === platform)
    : allApps;

  const header = [
    { value: t('appId') },
    { value: t('appName') },
    { value: t('platform') },
  ];
  const rows = [];
  for (const app of list) {
    rows.push([app.id, app.name, app.platform]);
  }

  // tty-table is ~25 ms to load; only pay for it when a table is rendered
  const Table = loadTtyTable();
  console.log(Table(header, rows).render());

  console.log(`\n${t('totalApps', { count: list.length, platform })}`);
  return list;
}

/** Prompt until the user chooses an app belonging to the target platform. */
export async function chooseApp(platform: Platform) {
  // Fail before a network request or table output when no prompt is possible.
  if (isNonInteractive()) {
    throw new Error(t('appIdRequired'));
  }
  const list = await listApp(platform);

  while (true) {
    const id = await question(t('enterAppIdQuestion'));
    const app = list.find((item: AppSummary) => String(item.id) === id);
    if (app) {
      return app;
    }
  }
}

/** Persist an app selection in the requested brand-aware config file. */
async function selectApp({
  args,
  options,
}: {
  args: string[];
  options: { platform?: Platform | ''; config?: string };
}) {
  const platform = await getPlatform(options.platform);
  const id = args[0] ? parseAppId(args[0]) : (await chooseApp(platform)).id;
  if (!id) {
    throw new Error(t('invalidId', { id: args[0] }));
  }
  const app = await assertAppPlatform(String(id), platform);
  if (typeof app.appKey !== 'string' || !app.appKey) {
    throw new Error(t('appKeyMissing', { appId: id }));
  }
  const appKey = app.appKey;

  const configPath = options.config || updateJson;
  const updateInfo = (await readUpdateInfo(configPath)) ?? {};
  updateInfo[platform] = {
    // 遗留服务沿用数字 appId 的历史契约；独立服务才可能写入 UUID。
    appId: /^[1-9]\d*$/.test(String(id)) ? Number(id) : String(id),
    appKey,
  };
  await fs.promises.writeFile(
    configPath,
    JSON.stringify(updateInfo, null, 4),
    'utf8',
  );
}

/** Build the application-management command handlers used by the CLI. */
export function getAppCommands() {
  return {
    /** Create an app and select it in the same configuration file. */
    createApp: async ({
      options,
    }: {
      options: {
        name: string;
        downloadUrl: string;
        platform?: Platform | '';
        config?: string;
      };
    }) => {
      const name = options.name || (await question(t('appNameQuestion')));
      const { downloadUrl } = options;
      const platform = await getPlatform(options.platform);
      const created = unwrapData<AppSummary & { appKey?: string }>(
        await post(
          isStandaloneService() ? servicePath('/apps') : '/app/create',
          isStandaloneService()
            ? {
                name,
                platform,
                ...(downloadUrl ? { nativePackageUrl: downloadUrl } : {}),
              }
            : { name, platform, downloadUrl },
        ),
      );
      const { id } = created;
      console.log(t('createAppSuccess', { id }));
      await selectApp({
        args: [String(id)],
        options: { platform, config: options.config },
      });
    },
    /** Delete the specified app, or prompt for one when no ID is supplied. */
    deleteApp: async ({
      args,
      options,
    }: {
      args: string[];
      options: { platform: Platform };
    }) => {
      const { platform } = options;
      const id = args[0] ? parseAppId(args[0]) : (await chooseApp(platform)).id;
      if (!id) {
        console.log(t('cancelled'));
        return;
      }
      await doDelete(
        isStandaloneService()
          ? servicePath(`/apps/${encodeURIComponent(String(id))}`)
          : `/app/${id}`,
      );
      console.log(t('operationSuccess'));
    },
    /** List apps through the command interface. */
    apps: async ({ options }: { options: { platform?: Platform | '' } }) => {
      const { platform = '' } = options;
      return listApp(platform);
    },
    /** List channels without exposing service-internal UUIDs as input. */
    channels: async ({
      options,
    }: {
      options: AppTargetOptions & { json?: boolean };
    }) => {
      const appId = await resolveAppId(options);
      if (!isStandaloneService()) {
        throw new Error(t('channelManagementStandaloneOnly'));
      }
      const channels = await getChannels(appId);
      if (options.json) {
        console.log(JSON.stringify(channels, null, 2));
      } else {
        for (const channel of channels) {
          console.log(
            `${channel.code}\t${channel.name}\t${channel.id}${channel.paused ? '\tpaused' : ''}`,
          );
        }
      }
      return channels;
    },
    /** Create a channel; the default channel is created with the application. */
    createChannel: async ({
      options,
    }: {
      options: AppTargetOptions & {
        code: string;
        name: string;
        nativePackageUrl?: string;
        paused?: boolean;
        json?: boolean;
      };
    }) => {
      const appId = await resolveAppId(options);
      if (!isStandaloneService()) {
        throw new Error(t('channelManagementStandaloneOnly'));
      }
      const channel = unwrapData(
        await post(servicePath(`/apps/${encodeURIComponent(appId)}/channels`), {
          code: options.code,
          name: options.name,
          nativePackageUrl: options.nativePackageUrl || '',
          paused: Boolean(options.paused),
        }),
      );
      console.log(
        options.json
          ? JSON.stringify(channel, null, 2)
          : t('channelCreated', { channel: options.code }),
      );
      return channel;
    },
    updateChannel: async ({
      args,
      options,
    }: {
      args: string[];
      options: AppTargetOptions & {
        code: string;
        name: string;
        nativePackageUrl?: string;
        paused?: boolean;
        json?: boolean;
      };
    }) => {
      const channelId = args[0];
      if (!channelId)
        throw new Error(t('channelIdRequired', { command: 'updateChannel' }));
      if (!isStandaloneService()) {
        throw new Error(t('channelManagementStandaloneOnly'));
      }
      const channel = unwrapData(
        await put(servicePath(`/channels/${encodeURIComponent(channelId)}`), {
          code: options.code,
          name: options.name,
          nativePackageUrl: options.nativePackageUrl || '',
          paused: Boolean(options.paused),
        }),
      );
      console.log(
        options.json
          ? JSON.stringify(channel, null, 2)
          : t('channelUpdated', { channel: channelId }),
      );
      return channel;
    },
    deleteChannel: async ({ args }: { args: string[] }) => {
      const channelId = args[0];
      if (!channelId)
        throw new Error(t('channelIdRequired', { command: 'deleteChannel' }));
      if (!isStandaloneService()) {
        throw new Error(t('channelManagementStandaloneOnly'));
      }
      await doDelete(servicePath(`/channels/${encodeURIComponent(channelId)}`));
      console.log(t('operationSuccess'));
    },
    selectApp,
  };
}
