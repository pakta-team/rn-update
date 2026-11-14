/**
 * [INPUT]: 依赖 i18next、CLI 中英文资源与环境/系统 locale 选择规则
 * [OUTPUT]: 对外提供语言选择、英文兜底、插值和资源键对称性的回归验证
 * [POS]: tests 的国际化契约入口，防止非中文环境意外继承中文输出
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { describe, expect, test } from 'bun:test';
import i18next from 'i18next';
import en from '../src/locales/en';
import zh from '../src/locales/zh';
import { resolveLanguage, t } from '../src/utils/i18n';

describe('i18n t()', () => {
  test('returns a non-empty translated string for a known key in English', async () => {
    await i18next.changeLanguage('en');
    const result = t('cancelled');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(result).toBe('Cancelled');
  });

  test('returns a non-empty translated string for a known key in Chinese', () => {
    i18next.changeLanguage('zh');
    const result = t('cancelled');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(result).toBe('已取消');
  });

  test('returns a translated string for a key with interpolation in English', () => {
    i18next.changeLanguage('en');
    const result = t('createAppSuccess', { id: '12345' });
    expect(typeof result).toBe('string');
    expect(result).toContain('12345');
  });

  test('returns a translated string for a key with interpolation in Chinese', () => {
    i18next.changeLanguage('zh');
    const result = t('createAppSuccess', { id: '67890' });
    expect(typeof result).toBe('string');
    expect(result).toContain('67890');
  });

  test('handles multiple interpolation options', () => {
    i18next.changeLanguage('en');
    const result = t('versionBind', {
      version: '1.0.0',
      nativeVersion: '2.0',
      id: 'abc',
    });
    expect(result).toContain('1.0.0');
    expect(result).toContain('2.0');
    expect(result).toContain('abc');
  });

  test('returns the key itself or a fallback for an unknown key', async () => {
    await i18next.changeLanguage('en');
    const result = t('this_key_does_not_exist_at_all');
    // i18next returns the key string when a key is missing
    expect(result).toBe('this_key_does_not_exist_at_all');
  });

  test('returns different strings for en and zh for the same key', () => {
    i18next.changeLanguage('en');
    const enResult = t('packing');
    i18next.changeLanguage('zh');
    const zhResult = t('packing');
    // Both should be non-empty strings
    expect(enResult.length).toBeGreaterThan(0);
    expect(zhResult.length).toBeGreaterThan(0);
    // They should differ (different languages)
    expect(enResult).not.toBe(zhResult);
  });
});

describe('resolveLanguage', () => {
  test('uses the runtime locale when no environment locale is set', () => {
    expect(resolveLanguage({}, 'zh-CN')).toBe('zh');
    expect(resolveLanguage({}, 'en-US')).toBe('en');
  });

  test('RNU_LANG overrides system locale and recognizes Chinese variants', () => {
    expect(resolveLanguage({ RNU_LANG: 'en' })).toBe('en');
    expect(resolveLanguage({ RNU_LANG: 'zh_CN.UTF-8' }, 'en-US')).toBe('zh');
    expect(resolveLanguage({ RNU_LANG: 'EN-us' })).toBe('en');
    expect(resolveLanguage({ RNU_LANG: 'zh-Hant' }, 'en-US')).toBe('zh');
    expect(resolveLanguage({ RNU_LANG: 'zhfoo' }, 'zh-CN')).toBe('en');
  });

  test('uses English for every non-Chinese locale', () => {
    expect(resolveLanguage({ RNU_LANG: 'fr', LANG: 'zh-CN' })).toBe('en');
    expect(resolveLanguage({ RNU_LANG: 'ja-JP' }, 'zh-CN')).toBe('en');
    expect(resolveLanguage({ RNU_LANG: 'C' }, 'zh-CN')).toBe('en');
  });

  test('checks locale variables in order and skips empty values', () => {
    expect(
      resolveLanguage({ LC_ALL: 'zh_CN.UTF-8', LANG: 'fr-FR' }, 'en-US'),
    ).toBe('zh');
    expect(
      resolveLanguage({ RNU_LANG: '', LC_ALL: '', LANG: 'fr-FR' }, 'zh-CN'),
    ).toBe('en');
    expect(
      resolveLanguage({ LC_ALL: 'fr-FR', LC_MESSAGES: 'zh-CN' }, 'zh-CN'),
    ).toBe('en');
  });

  test('keeps the English and Chinese resource keys symmetric', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
  });
});
