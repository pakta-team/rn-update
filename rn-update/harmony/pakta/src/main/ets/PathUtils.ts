/**
 * [INPUT]: 依赖服务端返回的版本/hash/文件名字符串与 ErrorCodes 错误构造，不引入平台 IO
 * [OUTPUT]: 对外提供 isSafePathComponent 与 assertSafePathComponent，阻断路径穿越和空组件
 * [POS]: Harmony 纯校验基础层，被 UpdateContext 与 NativeCheckOrchestrator 共享且不形成循环依赖
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { ERROR_INVALID_OPTIONS, createUpdateError } from './ErrorCodes';

// Server-controlled identifiers are used as children of the update root. Keep
// validation in a dependency-light module (ErrorCodes.ts has no imports) so
// startup orchestration and storage code can share it without creating an
// import cycle.
export function isSafePathComponent(name: string): boolean {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name !== '.' &&
    name !== '..' &&
    !name.includes('/') &&
    !name.includes('\\') &&
    !name.includes('\0')
  );
}

export function assertSafePathComponent(name: string): string {
  if (!isSafePathComponent(name)) {
    throw createUpdateError(
      ERROR_INVALID_OPTIONS,
      `Invalid path component: ${name}`,
    );
  }
  return name;
}
