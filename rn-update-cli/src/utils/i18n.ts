/**
 * [INPUT]: 依赖 i18next、CLI en/zh 文案资源与 RNU_LANG/系统 locale 环境覆盖
 * [OUTPUT]: 对外提供 resolveLanguage 与 t，初始化 Pakta CLI 本地化资源
 * [POS]: CLI 文案适配层，统一语言选择和模板翻译，不包含命令业务逻辑
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import i18next from 'i18next';
import en from '../locales/en';
import zh from '../locales/zh';

/**
 * 按显式覆盖、POSIX locale 变量和运行时 locale 的顺序选择 CLI 语言。
 * 只有中文 locale 选择中文资源，其余 locale 统一使用英文，避免国际环境继承中文输出。
 */
export function resolveLanguage(
  env: NodeJS.ProcessEnv = process.env,
  systemLanguage?: string,
): 'en' | 'zh' {
  const environmentLanguage = ['RNU_LANG', 'LC_ALL', 'LC_MESSAGES', 'LANG']
    .map((name) => env[name]?.trim())
    .find((value) => Boolean(value));
  const locale = (environmentLanguage || systemLanguage || getRuntimeLanguage())
    .trim()
    .toLowerCase();
  return /^zh(?:$|[-_])/.test(locale) ? 'zh' : 'en';
}

function getRuntimeLanguage(): string {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return 'en';
  }
}

i18next.init({
  lng: resolveLanguage(),
  fallbackLng: 'en',
  supportedLngs: ['en', 'zh'],
  resources: {
    en: {
      translation: en,
    },
    zh: {
      translation: zh,
    },
  },
  interpolation: {
    escapeValue: false,
  },
});

declare module 'i18next' {
  // Extend CustomTypeOptions
  interface CustomTypeOptions {
    // custom namespace type, if you changed it
    defaultNS: 'en';
    // custom resources type
    resources: {
      en: typeof en;
      zh: typeof zh;
    };
    // other
  }
}

export function t(key: string, options?: any): string {
  return i18next.t(key as any, options);
}
