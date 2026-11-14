/**
 * [INPUT]: 依赖 core 的原生身份与缓存、endpoint 和 updateFlowCore 的查询规则、NativeConfigSync 与 Reporter
 * [OUTPUT]: 对外提供 Checker，执行端点请求、缓存匹配、响应校验与设备灰度归一化
 * [POS]: src 的检查应用服务；缓存留在 Pakta 门面并按槽归属清理，动态调用公开请求与报告方法以保留实例替换边界
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { Platform } from 'react-native';
import type { Pakta } from './client';
import type { NativeConfigSync } from './clientNativeConfig';
import type { Reporter } from './clientReporter';
import {
  buildTime,
  channel,
  cInfo,
  currentVersion,
  getBundleHash,
  PaktaModule,
  supportedDiffVersion,
} from './core';
import { dedupeEndpoints, executeEndpointFallback } from './endpoint';
import { toUpdateError, UpdateError } from './error';
import type { CheckResult } from './type';
import {
  buildCheckFingerprint,
  buildCheckRequestBody,
  isValidCheckResult,
  resolveCheckResult,
} from './updateFlowCore';
import {
  assertWeb,
  DEFAULT_FETCH_TIMEOUT_MS,
  fetchWithTimeout,
  log,
  promiseAny,
  warn,
} from './utils';

const MAX_HTTP_ERROR_TEXT = 200;

type CheckHost = Pick<
  Pakta,
  | 'options'
  | 'lastChecking'
  | 'lastRespJson'
  | 'lastCheckFingerprint'
  | 'getEffectivePackageVersion'
  | 't'
  | 'assertDebug'
  | 'report'
  | 'notifyAfterCheckUpdate'
  | 'throwIfEnabled'
  | 'getCheckUrl'
  | 'getConfiguredCheckEndpoints'
  | 'getRemoteEndpoints'
  | 'requestCheckResult'
  | 'fetchCheckResult'
>;

export class Checker {
  lastWorkingEndpoint?: string;

  constructor(
    private readonly host: CheckHost,
    private readonly reporter: Reporter,
    private readonly nativeConfig: NativeConfigSync
  ) {}

  private jsonValuesEqual = (left: unknown, right: unknown): boolean => {
    const compare = (a: unknown, b: unknown): boolean => {
      if (a === b) {
        return true;
      }
      if (Array.isArray(a) || Array.isArray(b)) {
        return (
          Array.isArray(a) &&
          Array.isArray(b) &&
          a.length === b.length &&
          a.every((value, index) => compare(value, b[index]))
        );
      }
      if (
        a === null ||
        b === null ||
        typeof a !== 'object' ||
        typeof b !== 'object'
      ) {
        return false;
      }
      const leftObject = a as Record<string, unknown>;
      const rightObject = b as Record<string, unknown>;
      const leftKeys = Object.keys(leftObject)
        .filter((key) => leftObject[key] !== undefined)
        .sort();
      const rightKeys = Object.keys(rightObject)
        .filter((key) => rightObject[key] !== undefined)
        .sort();
      return (
        leftKeys.length === rightKeys.length &&
        leftKeys.every(
          (key, index) =>
            key === rightKeys[index] &&
            compare(leftObject[key], rightObject[key])
        )
      );
    };
    return compare(left, right);
  };

  getCheckUrl = (endpoint: string) =>
    `${endpoint}/checkUpdate/${this.host.options.appKey}`;

  getConfiguredCheckEndpoints = () => {
    const { server } = this.host.options;
    return server ? dedupeEndpoints(server.main) : [];
  };

  getRemoteEndpoints = async () => {
    const { server } = this.host.options;
    if (!server?.queryUrls?.length) {
      return [];
    }
    try {
      const remoteEndpoints = await promiseAny(
        server.queryUrls.map(async (queryUrl) => {
          const resp = await fetchWithTimeout(
            queryUrl,
            {},
            DEFAULT_FETCH_TIMEOUT_MS
          );
          if (!resp.ok) {
            throw Error(`${queryUrl}: ${resp.status}`);
          }
          const list: unknown = await resp.json();
          if (!Array.isArray(list)) {
            throw Error(`${queryUrl}: not an endpoint list`);
          }
          return list;
        })
      );
      log('fetch endpoints:', remoteEndpoints);
      const endpoints = dedupeEndpoints(
        remoteEndpoints.filter(
          (endpoint): endpoint is string =>
            typeof endpoint === 'string' && /^https:\/\//i.test(endpoint)
        )
      );
      const configured = new Set(this.host.getConfiguredCheckEndpoints());
      return endpoints.filter((endpoint) => !configured.has(endpoint));
    } catch (e) {
      log('failed to fetch endpoints from: ', server.queryUrls, e);
    }
    return [];
  };

  requestCheckResult = async (
    endpoint: string,
    fetchPayload: Parameters<typeof fetch>[1],
    signal?: AbortSignal
  ) => {
    const resp = await fetchWithTimeout(
      this.host.getCheckUrl(endpoint),
      fetchPayload,
      DEFAULT_FETCH_TIMEOUT_MS,
      signal
    );
    if (!resp.ok) {
      const respText = (await resp.text()).slice(0, MAX_HTTP_ERROR_TEXT);
      throw new UpdateError(
        this.host.t('error_http_status', {
          status: resp.status,
          statusText: respText,
        }),
        'HTTP_STATUS',
        { extra: { status: resp.status } }
      );
    }
    const result: unknown = await resp.json();
    if (!isValidCheckResult(result)) {
      throw new UpdateError(
        this.host.t('error_invalid_check_response'),
        'INVALID_RESPONSE'
      );
    }
    return result;
  };

  fetchCheckResult = async (fetchPayload: Parameters<typeof fetch>[1]) => {
    const { endpoint, value } = await executeEndpointFallback<CheckResult>({
      configuredEndpoints: this.host.getConfiguredCheckEndpoints(),
      getRemoteEndpoints: this.host.getRemoteEndpoints,
      tryEndpoint: async (currentEndpoint, signal) => {
        try {
          return await this.host.requestCheckResult(
            currentEndpoint,
            fetchPayload,
            signal
          );
        } catch (e) {
          log('check endpoint failed', currentEndpoint, e);
          throw e;
        }
      },
      onFirstFailure: ({ error }) => {
        this.host.report({
          type: 'errorChecking',
          message: this.host.t('error_cannot_connect_backup', {
            message: error.message,
          }),
        });
      },
    });
    log('check endpoint success', endpoint);
    this.lastWorkingEndpoint = endpoint;
    return value;
  };

  private readNativeCheckCache = async (
    requestBody: Record<string, any>
  ): Promise<CheckResult | undefined> => {
    try {
      if (__DEV__ || typeof PaktaModule.getNativeCheckCache !== 'function') {
        return undefined;
      }
      const raw = await Promise.resolve(PaktaModule.getNativeCheckCache());
      if (!raw || typeof raw !== 'string') {
        return undefined;
      }
      const entry = JSON.parse(raw);
      const config = this.nativeConfig.getNativeConfig();
      const cachedRequest =
        typeof entry?.request === 'string'
          ? JSON.parse(entry.request)
          : undefined;
      const cachedConfig =
        typeof entry?.config === 'string'
          ? JSON.parse(entry.config)
          : undefined;
      if (
        typeof entry?.ts !== 'number' ||
        typeof entry?.body !== 'string' ||
        !this.jsonValuesEqual(cachedRequest, requestBody) ||
        !config ||
        !this.jsonValuesEqual(cachedConfig, config)
      ) {
        return undefined;
      }
      const ageSeconds = Date.now() / 1000 - entry.ts;
      if (ageSeconds < 0 || ageSeconds > 120) {
        return undefined;
      }
      const result: unknown = JSON.parse(entry.body);
      if (!isValidCheckResult(result)) {
        return undefined;
      }
      log('reusing native check response cache');
      return result;
    } catch {
      return undefined;
    }
  };

  private resolveForThisDevice = (result: CheckResult): CheckResult =>
    result
      ? resolveCheckResult(
          result,
          {
            packageVersion: this.host.getEffectivePackageVersion(),
            currentVersion,
            uuid: cInfo.uuid,
          },
          log
        )
      : result;

  checkUpdate = async (extra?: Record<string, any>) => {
    if (!this.host.assertDebug('checkUpdate()')) {
      this.host.notifyAfterCheckUpdate({ status: 'skipped' });
      return;
    }
    if (!assertWeb()) {
      this.host.notifyAfterCheckUpdate({ status: 'skipped' });
      return;
    }
    if (
      this.host.options.beforeCheckUpdate &&
      (await this.host.options.beforeCheckUpdate()) === false
    ) {
      log('beforeCheckUpdate returned false, skipping check');
      this.host.notifyAfterCheckUpdate({ status: 'skipped' });
      return;
    }
    const bundleHash = __DEV__ ? '' : getBundleHash();
    const fetchBody = buildCheckRequestBody({
      packageVersion: this.host.getEffectivePackageVersion(),
      channel,
      currentVersion,
      buildTime,
      cInfo,
      supportedDiffVersion,
      bundleHash,
      isDev: __DEV__,
      extra,
    });
    const stringifyBody = JSON.stringify(fetchBody);
    const fingerprint = buildCheckFingerprint({
      appKey: this.host.options.appKey,
      endpoints: this.host.options.server?.main,
      queryUrls: this.host.options.server?.queryUrls,
      body: stringifyBody,
    });
    const now = Date.now();
    if (
      this.host.lastRespJson &&
      this.host.lastChecking &&
      this.host.lastCheckFingerprint === fingerprint &&
      now - this.host.lastChecking < 1000 * 5
    ) {
      try {
        const result = this.resolveForThisDevice(await this.host.lastRespJson);
        this.host.notifyAfterCheckUpdate({ status: 'completed', result });
        return result;
      } catch (e: any) {
        const err = toUpdateError(e, 'CHECK_FAILED');
        this.host.notifyAfterCheckUpdate({ status: 'error', error: err });
        this.host.throwIfEnabled(err);
        return undefined;
      }
    }
    this.host.lastChecking = now;
    this.host.lastCheckFingerprint = fingerprint;
    let body: any = fetchBody;
    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      body = stringifyBody;
    }
    const fetchPayload = {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body,
    };
    let respJsonPromise: Promise<CheckResult> | undefined;
    try {
      this.host.report({
        type: 'checking',
        message: `${this.host.options.appKey}: ${stringifyBody}`,
      });
      respJsonPromise = (async (): Promise<CheckResult> => {
        const cached = await this.readNativeCheckCache(fetchBody);
        return cached ?? (await this.host.fetchCheckResult(fetchPayload));
      })();
      this.host.lastRespJson = respJsonPromise;
      const rootResult: CheckResult = await respJsonPromise;
      log('checking result:', rootResult);
      if (rootResult?.bundleStatus === 'unknownBundle') {
        warn(this.host.t('warn_unknown_bundle'));
        this.host.report({
          type: 'bundleMismatch',
          data: bundleHash ? { bundleHash } : {},
        });
      }
      const result = this.resolveForThisDevice(rootResult);
      this.host.notifyAfterCheckUpdate({ status: 'completed', result });
      this.nativeConfig.markJsCheckCompleted();
      return result;
    } catch (e: any) {
      if (this.host.lastRespJson === respJsonPromise) {
        this.host.lastRespJson = undefined;
        this.host.lastCheckFingerprint = undefined;
      }
      const err = toUpdateError(e, 'CHECK_FAILED');
      this.reporter.emitError(err, 'errorChecking', {
        message: err.message || this.host.t('error_cannot_connect_server'),
      });
      this.host.notifyAfterCheckUpdate({ status: 'error', error: err });
      this.host.throwIfEnabled(err);
      return undefined;
    }
  };
}
