/**
 * [INPUT]: 依赖 NativePatchCore.normalizeConfiguration，经 NAPI 委托共享 native_config
 * [OUTPUT]: 提供 NativeUpdateConfig 与 normalizeNativeUpdateConfig，先拒绝非对象/channel，再返回共享核归一化 JSON
 * [POS]: Harmony 无桥 configure 的类型/序列化适配；白名单、URL 与默认服务归共享核，不触配置存储或更新状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import NativePatchCore from './NativePatchCore';

/** Options accepted by PaktaFileJSBundleProvider.configure(). */
export interface NativeUpdateConfig {
  appKey: string;
  /** Omitted: Pakta's built-in endpoints. Custom endpoints never inherit discovery URLs. */
  endpoints?: string[];
  queryUrls?: string[];
  /** Default: none. setNeedUpdate selects a downloaded bundle for the NEXT launch. */
  afterDownload?: 'none' | 'setNeedUpdate';
  disabled?: boolean;
  /** Omit to use the installed application's version. */
  packageVersion?: string;
  /** Optional telemetry version strings; not required to check or install an update. */
  rnu?: string;
  rn?: string;
}

/** Pure validation, before any native state is touched. Does not mutate options. */
export function normalizeNativeUpdateConfig(options: NativeUpdateConfig): string {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('Invalid native configuration: expected an object');
  }
  if (Object.keys(options).includes('channel')) {
    throw new Error('Invalid native configuration: unknown option channel');
  }
  return NativePatchCore.normalizeConfiguration(JSON.stringify(options));
}
