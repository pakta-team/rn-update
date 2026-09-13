/**
 * [INPUT]: 依赖 react-native 的 NativeModules/NativeEventEmitter/Platform、Codegen NativePakta、错误与国际化服务及空模块工具
 * [OUTPUT]: 对外提供 PaktaModule/UpdateModule、原生版本常量、bundle hash/版本信息访问器、事件发射器与设备上报信息 cInfo
 * [POS]: src 的原生桥接适配器，屏蔽 TurboModule 与旧桥差异，为 client 提供稳定且平台无关的运行时状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { UpdateError } from './error';
import i18n from './i18n';
import { emptyModule, error, log } from './utils';

/* eslint-disable @react-native/no-deep-imports */
const {
  version: v,
} = require('react-native/Libraries/Core/ReactNativeVersion');
const RNVersion = `${v.major}.${v.minor}.${v.patch}`;
const isTurboModuleEnabled =
  // https://github.com/facebook/react-native/pull/48362
  (global as any).__turboModuleProxy || (global as any).RN$Bridgeless;

const isWebPlatform = Platform.OS === 'web';

export const PaktaModule = isWebPlatform
  ? emptyModule
  : isTurboModuleEnabled
    ? require('./NativePakta').default
    : NativeModules.Pakta;

export const UpdateModule = PaktaModule;

if (!PaktaModule) {
  throw new UpdateError(
    'Failed to load rn-update native module, please try to recompile',
    'MODULE_NOT_LOADED'
  );
}

// On web PaktaModule is a Proxy whose every property is a noop function, so
// reading the constants off it would make each of them a function:
// `isRolledBack` true (a fake rollback report on every page load), a uuid of
// "() => {}", JSON.parse failing on currentVersionInfo. Web has no native
// state at all, so its constants are the explicit empty ones.
const PaktaConstants: Record<string, any> = isWebPlatform
  ? {
      downloadRootDir: '',
      packageVersion: '',
      currentVersion: '',
      isFirstTime: false,
      rolledBackVersion: '',
      buildTime: '',
      channel: 'default',
      uuid: '',
      currentVersionInfo: '',
      supportedDiffVersion: 0,
      currentBundleSha256: '',
    }
  : isTurboModuleEnabled
    ? PaktaModule.getConstants()
    : PaktaModule;

export const downloadRootDir: string = PaktaConstants.downloadRootDir;
export const packageVersion: string = PaktaConstants.packageVersion;
export const currentVersion: string = PaktaConstants.currentVersion;

export function setLocalHashInfo(
  hash: string,
  info: Record<string, any>
): Promise<void> {
  // Always a promise so callers can await native persistence (the legacy
  // bridge returns undefined when no promise is exposed).
  return Promise.resolve(
    PaktaModule.setLocalHashInfo(hash, JSON.stringify(info))
  );
}

const currentVersionInfoString: string = PaktaConstants.currentVersionInfo;
let _currentVersionInfo: Record<string, any> = {};
let isDebugChannel = false;
if (currentVersionInfoString) {
  try {
    _currentVersionInfo = JSON.parse(currentVersionInfoString);
    if (_currentVersionInfo.debugChannel) {
      isDebugChannel = true;
      delete _currentVersionInfo.debugChannel;
      setLocalHashInfo(currentVersion, _currentVersionInfo).catch((e) => {
        error('failed to persist version info', e);
      });
    }
  } catch {
    error(
      i18n.t('error_parse_version_info', { info: currentVersionInfoString })
    );
  }
}
export const currentVersionInfo = _currentVersionInfo;
/** SHA-256 of the running hot-update bundle from its install record; '' when unknown. */
export const currentBundleSha256: string =
  typeof PaktaConstants.currentBundleSha256 === 'string'
    ? PaktaConstants.currentBundleSha256
    : '';

export const isFirstTime: boolean = PaktaConstants.isFirstTime;
export const isFirstTimeDebug: boolean = isFirstTime && isDebugChannel;
export const rolledBackVersion: string = PaktaConstants.rolledBackVersion;
export const isRolledBack: boolean = !!rolledBackVersion;

export const buildTime: string = PaktaConstants.buildTime;
/** Immutable distribution channel declared by the native binary. */
export const channel: string =
  typeof PaktaConstants.channel === 'string' && PaktaConstants.channel
    ? PaktaConstants.channel
    : 'default';
// 原生 patch 内核可消费的 diff 轨道版本(2 = hdiffv2 轨道:HBC 变换 +
// 流式容器);旧原生无此常量时为 0(不上报,服务端只发 baseline)
export const supportedDiffVersion: number =
  PaktaConstants.supportedDiffVersion || 0;
let uuid = PaktaConstants.uuid;

// bundleHash = sha256 of the JS bundle embedded in the binary (the pdiff
// source). Content identity for the server's pdiff-applicability check,
// replacing the buildTime heuristic. Natively lazy-computed and cached;
// prefetched fire-and-forget at module load so the value is usually settled
// before the first checkUpdate builds its body. Until then (first install,
// slow device) getBundleHash returns '' and the field is simply omitted — the
// server falls back to the buildTime heuristic and the next check carries it.
// Deliberately synchronous at read time: checkUpdate must not await anything
// between its dedup window and the fetch, and a hash is never worth delaying
// a check for.
let bundleHash = '';
// The JS layer can arrive via hot update onto an older binary whose native
// module predates the method, hence the feature detect (on web the noop Proxy
// would pass it, so web is excluded explicitly).
if (!isWebPlatform && typeof PaktaModule.getBundleHash === 'function') {
  Promise.resolve(PaktaModule.getBundleHash())
    .then((hash: unknown) => {
      bundleHash = String(hash || '');
    })
    .catch((e: any) => {
      log('getBundleHash failed:', e?.message || e);
    });
}

/** '' while unknown (not yet computed, debug build, no embedded bundle, older native). */
export const getBundleHash = (): string => bundleHash;

// Natives resolve null/'' when no record exists for the hash (only a record
// that exists and is not a JSON object rejects with INVALID_HASH_INFO).
async function getLocalHashInfo(hash: string) {
  const raw = await PaktaModule.getLocalHashInfo(hash);
  return raw ? JSON.parse(raw) : null;
}

// @deprecated use currentVersionInfo instead
export async function getCurrentVersionInfo(): Promise<{
  name?: string;
  description?: string;
  metaInfo?: string;
}> {
  return currentVersion ? (await getLocalHashInfo(currentVersion)) || {} : {};
}

export const paktaNativeEventEmitter = new NativeEventEmitter(PaktaModule);

if (!uuid) {
  uuid = require('nanoid/non-secure').nanoid();
  // If persisting fails the uuid drifts on every launch, which skews gray
  // release bucketing and inflates stats — log it instead of failing silently.
  // Web has nowhere to persist it (nothing runs there anyway).
  if (!isWebPlatform) {
    Promise.resolve(PaktaModule.setUuid(uuid)).catch((e: any) => {
      log('setUuid error:', e?.message || e);
    });
  }
}

export const cInfo = {
  rnu: require('../package.json').version,
  rn: RNVersion,
  os: `${Platform.OS} ${Platform.Version}`,
  uuid,
};

log('bootup status', {
  packageVersion,
  currentVersion,
  currentVersionInfo,
  isFirstTime,
  isFirstTimeDebug,
  isDebugChannel,
  cInfo,
});
