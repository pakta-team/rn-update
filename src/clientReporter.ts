/**
 * [INPUT]: 依赖 core 启动身份、telemetry 事件映射、errorReporting 异常管线与超时请求工具，延迟读取门面和工作端点
 * [OUTPUT]: 对外提供 Reporter、ReportEvent 与 UpdateErrorListener，执行事件与异常去重、错误监听及全局异常处理
 * [POS]: src 的可观测性边界；报告通过 Pakta 公开方法转发，保留实例替换、有界遥测等待与失败吞并，不拥有更新生命周期状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { Pakta } from './client';
import {
  buildTime,
  channel,
  cInfo,
  currentVersion,
  currentVersionInfo,
  packageVersion,
} from './core';
import type { UpdateError, UpdateErrorCode } from './error';
import {
  type ErrorReportContext,
  type ErrorReportingOptions,
  installGlobalErrorHandler,
  type SerializedException,
  serializeException,
} from './errorReporting';
import {
  resolveServerEventHash,
  resolveServerEventType,
  truncateDetail,
} from './telemetry';
import type { EventType, UpdateCheckState } from './type';
import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout, log, noop } from './utils';

export type UpdateErrorListener = (
  error: UpdateError,
  eventType: EventType
) => void;
export interface ReportEvent {
  type: EventType;
  message?: string;
  code?: UpdateErrorCode;
  data?: Record<string, string | number>;
}

type ReporterHost = Pick<
  Pakta,
  | 'options'
  | 'loggerPromise'
  | 'getEffectivePackageVersion'
  | 'report'
  | 'captureException'
  | 'enableErrorReporting'
>;

export class Reporter {
  private reportedInvalidUpdates = new Set<string>();
  private reportedExceptions = new WeakSet<object>();
  private globalErrorCleanup?: () => void;
  private errorListeners = new Set<UpdateErrorListener>();
  private emittedErrors = new WeakSet<Error>();

  constructor(
    private readonly host: ReporterHost,
    private readonly telemetryEndpoint: () => string | undefined
  ) {}

  syncAutomaticErrorReporting = (): void => {
    if (
      this.host.options.disableTelemetry ||
      this.host.options.disableErrorReporting
    ) {
      this.globalErrorCleanup?.();
      return;
    }
    this.host.enableErrorReporting();
  };

  reportInvalidUpdateOnce = (
    reason: 'missingHash' | 'noArtifact',
    hash = ''
  ) => {
    const key = `${this.host.options.appKey}:${reason}:${hash}`;
    if (this.reportedInvalidUpdates.has(key)) {
      return;
    }
    this.reportedInvalidUpdates.add(key);
    this.host.report({
      type: 'errorUpdate',
      message:
        reason === 'missingHash'
          ? 'update response is missing a version hash'
          : 'update response contains no downloadable artifact',
      ...(hash ? { data: { newVersion: hash } } : {}),
    });
  };

  captureException = (
    error: unknown,
    context: ErrorReportContext = {}
  ): void => {
    try {
      if (
        __DEV__ ||
        this.host.options.disableTelemetry ||
        this.host.options.disableErrorReporting
      ) {
        return;
      }
      if (
        error !== null &&
        (typeof error === 'object' || typeof error === 'function')
      ) {
        const object = error as object;
        if (this.reportedExceptions.has(object)) {
          return;
        }
        this.reportedExceptions.add(object);
      }
      this.reportExceptionToServer(serializeException(error, context));
    } catch (e: any) {
      log('exception telemetry error:', e?.message || e);
    }
  };

  enableErrorReporting = (
    options: ErrorReportingOptions = {}
  ): (() => void) => {
    if (
      options.captureGlobal === false ||
      this.host.options.disableTelemetry ||
      this.host.options.disableErrorReporting
    ) {
      return () => {};
    }
    if (this.globalErrorCleanup) {
      return this.globalErrorCleanup;
    }
    const uninstall = installGlobalErrorHandler((error, isFatal) => {
      this.host.captureException(error, { fatal: isFatal === true });
    });
    let active = true;
    const cleanup = () => {
      if (!active) {
        return;
      }
      active = false;
      uninstall();
      if (this.globalErrorCleanup === cleanup) {
        this.globalErrorCleanup = undefined;
      }
    };
    this.globalErrorCleanup = cleanup;
    return cleanup;
  };

  private reportExceptionToServer = (error: SerializedException): void => {
    try {
      if (
        __DEV__ ||
        this.host.options.disableTelemetry ||
        this.host.options.disableErrorReporting ||
        !currentVersion
      ) {
        return;
      }
      const { appKey } = this.host.options;
      const endpoint = this.telemetryEndpoint();
      if (!appKey || !endpoint) {
        return;
      }
      fetchWithTimeout(
        `${endpoint}/report/${appKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'js_exception',
            hash: currentVersion,
            packageVersion: this.host.getEffectivePackageVersion(),
            cInfo,
            error,
          }),
        },
        DEFAULT_FETCH_TIMEOUT_MS
      ).catch((e: any) => {
        log('exception telemetry report failed:', e?.message || e);
      });
    } catch (e: any) {
      log('exception telemetry error:', e?.message || e);
    }
  };

  report = async ({ type, message = '', code, data = {} }: ReportEvent) => {
    log(`${type} ${code ? `[${code}] ` : ''}${message}`);
    const telemetryTask = this.reportToServer({ type, message, code, data });
    if (this.host.options.logger === noop) {
      let timer: unknown;
      await Promise.race([
        this.host.loggerPromise.promise,
        new Promise<void>((resolve) => {
          timer = setTimeout(() => resolve(), 10 * 1000);
        }),
      ]);
      if (timer !== undefined) {
        clearTimeout(Number(timer));
      }
    }
    const { logger = noop, appKey } = this.host.options;
    const overridePackageVersion = this.host.options.overridePackageVersion;
    try {
      logger({
        type,
        data: {
          appKey,
          currentVersion,
          cInfo,
          packageVersion,
          overridePackageVersion,
          buildTime,
          message,
          code,
          ...currentVersionInfo,
          ...data,
        },
      });
    } catch (e: any) {
      log('logger error:', e?.message || e);
    }
    return telemetryTask;
  };

  private reportToServer = ({
    type,
    message = '',
    code,
    data = {},
  }: ReportEvent): Promise<void> => {
    try {
      if (__DEV__ || this.host.options.disableTelemetry) {
        return Promise.resolve();
      }
      const serverType = resolveServerEventType(type, code);
      if (!serverType) {
        return Promise.resolve();
      }
      const { appKey } = this.host.options;
      const endpoint = this.telemetryEndpoint();
      if (!appKey || !endpoint) {
        return Promise.resolve();
      }
      const hash = resolveServerEventHash({ serverType, data, currentVersion });
      if (!hash) {
        return Promise.resolve();
      }
      return fetchWithTimeout(
        `${endpoint}/report/${appKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: serverType,
            hash,
            packageVersion: this.host.getEffectivePackageVersion(),
            channel,
            buildTime,
            cInfo,
            detail: truncateDetail(message || undefined),
          }),
        },
        DEFAULT_FETCH_TIMEOUT_MS
      )
        .then(() => undefined)
        .catch((e: any) => {
          log('telemetry report failed:', e?.message || e);
        });
    } catch (e: any) {
      log('telemetry error:', e?.message || e);
      return Promise.resolve();
    }
  };

  throwIfEnabled = (e: Error) => {
    if (this.host.options.throwError) {
      throw e;
    }
  };

  onError = (listener: UpdateErrorListener) => {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  };

  wasEmitted = (e: unknown): boolean =>
    e instanceof Error && this.emittedErrors.has(e);

  emitError = (
    error: UpdateError,
    type: EventType,
    {
      message = error.message,
      data,
    }: { message?: string; data?: Record<string, string | number> } = {}
  ) => {
    this.emittedErrors.add(error);
    this.host.report({
      type,
      message,
      code: error.code,
      data: error.extra ? { ...error.extra, ...data } : data,
    });
    for (const listener of this.errorListeners) {
      try {
        listener(error, type);
      } catch (e: any) {
        log('onError listener error:', e?.message || e);
      }
    }
  };

  notifyAfterCheckUpdate = (state: UpdateCheckState) => {
    const { afterCheckUpdate } = this.host.options;
    if (!afterCheckUpdate) {
      return;
    }
    Promise.resolve(afterCheckUpdate(state)).catch((error: any) => {
      log('afterCheckUpdate failed:', error?.message || error);
    });
  };
}
