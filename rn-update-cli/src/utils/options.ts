/**
 * [INPUT]: 依赖 CLI 参数对象与字符串/布尔/列表的约定
 * [OUTPUT]: 对外提供环境开关与布尔、字符串、可选字符串、逗号列表选项读取函数
 * [POS]: CLI 参数基础设施，统一命令模块的输入边界，不了解具体命令业务
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

/** `1` or `true` (any case), the usual spelling of an enabled env flag */
export function isTruthyEnv(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

export function getBooleanOption(
  options: Record<string, unknown>,
  key: string,
  fallback = false,
): boolean {
  const value = options[key];
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true';
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  return fallback;
}

export function getStringOption(
  options: Record<string, unknown>,
  key: string,
  fallback = '',
): string {
  const value = options[key];
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return fallback;
}

export function getOptionalStringOption(
  options: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = options[key];
  if (typeof value === 'string') {
    return value || undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

export function getStringListOption(
  options: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const value = options[key];
  const rawValues = Array.isArray(value) ? value : [value];
  const result = rawValues.flatMap((item) => {
    if (typeof item === 'string') {
      return item
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    }
    if (typeof item === 'number' || typeof item === 'boolean') {
      return [String(item)];
    }
    return [];
  });

  return result.length > 0 ? result : undefined;
}
