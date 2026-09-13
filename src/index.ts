/**
 * [INPUT]: 依赖 client、context、core、error 与 provider 已稳定的公开契约
 * [OUTPUT]: 对外提供 npm 包支持的 Pakta 客户端、Provider、Context/hooks、原生模块与错误 API
 * [POS]: src 的唯一公共门面，隔离内部文件布局，消费端应从包入口而非深路径导入
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export type { UpdateErrorListener } from './client';
export { Pakta } from './client';
export type { UpdateContextValue } from './context';
export {
  ProgressContext,
  UpdateContext,
  usePakta,
  useUpdate,
  useUpdateProgress,
} from './context';
export { buildTime, channel, PaktaModule, UpdateModule } from './core';
export type { UpdateErrorCode } from './error';
export { UpdateError } from './error';
export type {
  ErrorContextValue,
  ErrorReportContext,
  ErrorReportingOptions,
  SerializedException,
} from './errorReporting';
export type { CrashReporterLike, UpdateMetadata } from './metadata';
export {
  attachToCrashlytics,
  attachToSentry,
  attachUpdateMetadata,
  getUpdateMetadata,
  updateMetadataTags,
} from './metadata';
export { PaktaProvider, UpdateProvider } from './provider';
export type {
  BeforeReloadContext,
  CheckResult,
  ClientOptions,
  EventData,
  EventType,
  ProgressData,
  UpdateCheckState,
  UpdateEventsLogger,
  UpdateServerConfig,
  UpdateTestPayload,
  VersionInfo,
} from './type';
