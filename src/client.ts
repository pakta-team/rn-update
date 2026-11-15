/**
 * [INPUT]: 依赖六个 client 职责模块、core 启动身份、端点归一化、错误/类型与日志/翻译工具
 * [OUTPUT]: 提供 Pakta 门面、sharedState 与重导出的 UpdateErrorListener，保留可替换箭头方法和可写检查缓存
 * [POS]: src 的客户端装配与公开状态所有者；模块求值时创建状态并注入下载/激活，统一单例、配置通知与 Provider 挂载约束
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { Platform } from 'react-native';
import { Activation } from './clientActivation';
import { Checker } from './clientCheck';
import { Downloader } from './clientDownload';
import { NativeConfigSync } from './clientNativeConfig';
import { type ReportEvent, Reporter } from './clientReporter';
import { createProcessState } from './clientState';
import { cInfo, isRolledBack, packageVersion, rolledBackVersion } from './core';
import { dedupeEndpoints } from './endpoint';
import { UpdateError } from './error';
import i18n from './i18n';
import type { CheckResult, ClientOptions, UpdateServerConfig } from './type';
import { assertWeb, info, log, noop, setDebugLogging } from './utils';

export type { UpdateErrorListener } from './clientReporter';

const SERVER_PRESET: UpdateServerConfig = {
  main: ['https://pakta.yoghourt.space/api'],
  queryUrls: [
    'https://cdn.jsdelivr.net/gh/pakta-team/rn-update@main/endpoints.json',
  ],
};

const cloneServerConfig = (server: UpdateServerConfig): UpdateServerConfig => ({
  main: dedupeEndpoints([...(server.main || [])]),
  queryUrls: server.queryUrls ? [...server.queryUrls] : undefined,
});

assertWeb();

const createDefaultClientOptions = (): ClientOptions => ({
  appKey: '',
  autoMarkSuccess: true,
  updateStrategy: __DEV__ ? 'alwaysAlert' : 'alertUpdateAndIgnoreError',
  checkStrategy: 'both',
  logger: noop,
  debug: false,
  throwError: false,
  disableErrorReporting: false,
});

const processState = createProcessState();
export const sharedState = processState.shared;
let activeClient: Pakta | undefined;

export class Pakta {
  options: ClientOptions = createDefaultClientOptions();
  clientType: 'Pakta' = 'Pakta';
  lastChecking?: number;
  lastRespJson?: Promise<CheckResult>;
  lastCheckFingerprint?: string;
  version = cInfo.rnu;
  loggerPromise = (() => {
    let resolve: (value?: unknown) => void = () => {};
    const promise = new Promise((res) => {
      resolve = res;
    });
    return { promise, resolve };
  })();

  private readonly reporter = new Reporter(
    this,
    () => this.checker.lastWorkingEndpoint || this.options.server?.main?.[0]
  );
  private readonly nativeConfig = new NativeConfigSync(this);
  private readonly checker = new Checker(
    this,
    this.reporter,
    this.nativeConfig
  );
  private readonly downloader = new Downloader(
    this,
    this.reporter,
    processState
  );
  private readonly activation = new Activation(
    this,
    this.reporter,
    processState
  );

  constructor(options: ClientOptions) {
    if (activeClient) {
      if (activeClient.options.appKey === options.appKey) {
        activeClient.setOptions(options);
        // biome-ignore lint/correctness/noConstructorReturn: intentional singleton — identical re-creation must yield the existing instance
        return activeClient;
      }
      throw new UpdateError(
        i18n.t('error_client_singleton'),
        'SINGLETON_VIOLATION'
      );
    }
    this.options.server = cloneServerConfig(SERVER_PRESET);
    i18n.setLocale(options.locale ?? 'zh');
    if (Platform.OS !== 'web' && !options.appKey) {
      throw new UpdateError(i18n.t('error_appkey_required'), 'APPKEY_REQUIRED');
    }
    this.setOptions(options);
    if (isRolledBack) {
      this.report({ type: 'rollback', data: { rolledBackVersion } });
    }
    activeClient = this;
  }

  optionsVersion = 0;
  private optionsListeners = new Set<() => void>();

  onOptionsChange = (listener: () => void) => {
    this.optionsListeners.add(listener);
    return () => {
      this.optionsListeners.delete(listener);
    };
  };

  setOptions = (options: Partial<ClientOptions>) => {
    for (const [key, value] of Object.entries(options)) {
      if (value !== undefined) {
        (this.options as any)[key] =
          key === 'server'
            ? cloneServerConfig(value as UpdateServerConfig)
            : value;
        if (key === 'logger') {
          this.loggerPromise.resolve();
        }
        if (key === 'locale') {
          i18n.setLocale(value as 'zh' | 'en');
        }
      }
    }
    setDebugLogging(!!this.options.debug);
    this.optionsVersion++;
    for (const listener of this.optionsListeners) {
      try {
        listener();
      } catch (e: any) {
        log('onOptionsChange listener error:', e?.message || e);
      }
    }
    this.reporter.syncAutomaticErrorReporting();
    this.nativeConfig.syncNativeConfig();
  };

  getEffectivePackageVersion = () =>
    this.options.overridePackageVersion || packageVersion;
  private providerMounted = false;

  claimProviderMount = () => {
    if (this.providerMounted) {
      throw new UpdateError(
        this.t('error_provider_singleton'),
        'SINGLETON_VIOLATION'
      );
    }
    this.providerMounted = true;
    return () => {
      this.providerMounted = false;
    };
  };

  t = (key: string, values?: Record<string, string | number>) =>
    i18n.t(key as any, values);

  assertDebug = (matter: string) => {
    if (__DEV__ && !this.options.debug) {
      info(this.t('dev_debug_disabled', { matter }));
      return false;
    }
    return true;
  };

  report = (event: ReportEvent): Promise<void> => this.reporter.report(event);
  reportInvalidUpdateOnce: Reporter['reportInvalidUpdateOnce'] = (...args) =>
    this.reporter.reportInvalidUpdateOnce(...args);
  captureException: Reporter['captureException'] = (...args) =>
    this.reporter.captureException(...args);
  enableErrorReporting: Reporter['enableErrorReporting'] = (...args) =>
    this.reporter.enableErrorReporting(...args);
  throwIfEnabled = (e: Error): void => this.reporter.throwIfEnabled(e);
  onError: Reporter['onError'] = (listener) => this.reporter.onError(listener);
  wasEmitted = (e: unknown): boolean => this.reporter.wasEmitted(e);
  notifyAfterCheckUpdate: Reporter['notifyAfterCheckUpdate'] = (state) =>
    this.reporter.notifyAfterCheckUpdate(state);

  getCheckUrl = (endpoint: string): string =>
    this.checker.getCheckUrl(endpoint);
  getConfiguredCheckEndpoints = (): string[] =>
    this.checker.getConfiguredCheckEndpoints();
  getRemoteEndpoints = (): Promise<string[]> =>
    this.checker.getRemoteEndpoints();
  requestCheckResult = (
    endpoint: string,
    fetchPayload: Parameters<typeof fetch>[1],
    signal?: AbortSignal
  ): Promise<CheckResult> =>
    this.checker.requestCheckResult(endpoint, fetchPayload, signal);
  fetchCheckResult = (
    fetchPayload: Parameters<typeof fetch>[1]
  ): Promise<CheckResult> => this.checker.fetchCheckResult(fetchPayload);
  checkUpdate: Checker['checkUpdate'] = (extra) =>
    this.checker.checkUpdate(extra);

  downloadUpdate: Downloader['downloadUpdate'] = (...args) =>
    this.downloader.downloadUpdate(...args);
  downloadAndInstallApk: Downloader['downloadAndInstallApk'] = (...args) =>
    this.downloader.downloadAndInstallApk(...args);

  runBeforeReload: Activation['runBeforeReload'] = (context) =>
    this.activation.runBeforeReload(context);
  markSuccess = () => this.activation.markSuccess();
  getDownloadedHash = (): string | undefined =>
    this.activation.getDownloadedHash();
  switchVersion = (hash: string): Promise<boolean> =>
    this.activation.switchVersion(hash);
  switchVersionLater = (hash: string) =>
    this.activation.switchVersionLater(hash);
  restartApp = () => this.activation.restartApp();
  resetToPackagedBundle: Activation['resetToPackagedBundle'] = (options) =>
    this.activation.resetToPackagedBundle(options);
}
