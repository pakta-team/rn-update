/**
 * [INPUT]: 依赖 CLI CommandResult 公共类型与未知错误值
 * [OUTPUT]: 对外提供错误归一化与 runAsCommandResult，统一命令层结果形状
 * [POS]: CLI 命令边界的错误适配器，隔离异常来源与顶层输出协议
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import type { CommandResult } from '../types';

export function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export async function runAsCommandResult<T>(
  task: () => Promise<T>,
  fallbackError: string,
  mapSuccess?: (result: T) => unknown,
): Promise<CommandResult> {
  try {
    const result = await task();
    return {
      success: true,
      data: mapSuccess ? mapSuccess(result) : result,
    };
  } catch (error) {
    return {
      success: false,
      error: toErrorMessage(error, fallbackError),
    };
  }
}
