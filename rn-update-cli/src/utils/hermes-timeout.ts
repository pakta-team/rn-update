/**
 * [INPUT]: 依赖调用方或环境变量提供的 Hermes 子进程超时值与默认期限
 * [OUTPUT]: 对外提供经过整数、正数和 Node 定时器上限校验的超时毫秒数
 * [POS]: CLI Hermes 进程边界的共享安全策略，供探测、编译和等价审计复用
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

/** Reject invalid/overflowing timer values instead of turning them into 1ms. */
export function hermesTimeout(value: unknown, fallback: number): number {
  let parsed: number;
  try {
    parsed = Number(value);
  } catch {
    return fallback;
  }
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 0x7fffffff
    ? parsed
    : fallback;
}
