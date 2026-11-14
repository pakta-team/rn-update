/**
 * [INPUT]: 依赖 options 的布尔、字符串、可选值和列表读取原语
 * [OUTPUT]: 验证原始类型转换、缺省值、空值过滤及重复/逗号列表展开
 * [POS]: CLI 参数归一化的纯函数边界，不承担命令白名单或业务校验
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { describe, expect, test } from 'bun:test';
import {
  getBooleanOption,
  getOptionalStringOption,
  getStringListOption,
  getStringOption,
} from '../src/utils/options';

describe('utils/options', () => {
  test('getBooleanOption handles boolean/string/number and fallback', () => {
    expect(getBooleanOption({ enabled: true }, 'enabled', false)).toBe(true);
    expect(getBooleanOption({ enabled: 'true' }, 'enabled', false)).toBe(true);
    expect(getBooleanOption({ enabled: 'TRUE' }, 'enabled', false)).toBe(true);
    expect(getBooleanOption({ enabled: 'false' }, 'enabled', true)).toBe(false);
    expect(getBooleanOption({ enabled: 1 }, 'enabled', false)).toBe(true);
    expect(getBooleanOption({ enabled: 0 }, 'enabled', true)).toBe(false);
    expect(getBooleanOption({}, 'enabled', true)).toBe(true);
  });

  test('getStringOption returns stringified primitive or fallback', () => {
    expect(getStringOption({ name: 'pushy' }, 'name', 'default')).toBe('pushy');
    expect(getStringOption({ name: 100 }, 'name', 'default')).toBe('100');
    expect(getStringOption({ name: false }, 'name', 'default')).toBe('false');
    expect(getStringOption({ name: null }, 'name', 'default')).toBe('default');
  });

  test('getOptionalStringOption returns undefined for empty or invalid values', () => {
    expect(getOptionalStringOption({ key: 'value' }, 'key')).toBe('value');
    expect(getOptionalStringOption({ key: 42 }, 'key')).toBe('42');
    expect(getOptionalStringOption({ key: true }, 'key')).toBe('true');
    expect(getOptionalStringOption({ key: '' }, 'key')).toBeUndefined();
    expect(getOptionalStringOption({ key: null }, 'key')).toBeUndefined();
    expect(getOptionalStringOption({}, 'key')).toBeUndefined();
  });

  test('getStringListOption parses comma separated and repeated values', () => {
    expect(getStringListOption({ ids: '1, 2,,3' }, 'ids')).toEqual([
      '1',
      '2',
      '3',
    ]);
    expect(getStringListOption({ ids: ['1,2', '3'] }, 'ids')).toEqual([
      '1',
      '2',
      '3',
    ]);
    expect(getStringListOption({ ids: 10 }, 'ids')).toEqual(['10']);
    expect(getStringListOption({ ids: '' }, 'ids')).toBeUndefined();
    expect(getStringListOption({}, 'ids')).toBeUndefined();
  });
});
