/**
 * [INPUT]: 依赖 CLI 会话、应用、差分、发布 Provider、公共类型与交互工具模块
 * [OUTPUT]: 对外提供包级公共 API，维持命令扩展和宿主集成所需的稳定导出面
 * [POS]: CLI 公共出口，只聚合已定义的能力，不承载业务逻辑或状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

export { getSession, loadSession } from './api';
export { getPlatform, getSelectedApp } from './app';
export { diffCommands } from './diff';
export { CLIProviderImpl } from './provider';
export type {
  BundleOptions,
  CLIProvider,
  CommandContext,
  CommandResult,
  Package,
  Platform,
  PublishOptions,
  Session,
  UploadOptions,
  Version,
} from './types';
export { question } from './utils';
