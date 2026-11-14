/**
 * [INPUT]: 依赖本地化文案与已登记的 CLI 插件配置
 * [OUTPUT]: 对外提供 checkPlugins，校验插件组合并返回 bundle 参数
 * [POS]: CLI 插件兼容性检查边界，连接配置声明与 bundle 编排，不执行插件安装
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { pathExists } from './fs-helpers';
import { t } from './i18n';

/**
 * Bundle params implied by the project's plugins. Sentry (a sentry.properties
 * under ios/ or android/) turns on its source map upload, and with it the
 * source map itself.
 */
export async function checkPlugins(): Promise<{
  sentry: boolean;
  sourcemap: boolean;
}> {
  const [ios, android] = await Promise.all([
    pathExists('ios/sentry.properties'),
    pathExists('android/sentry.properties'),
  ]);
  const sentry = ios || android;
  if (sentry) {
    console.log(t('pluginDetected', { name: 'sentry' }));
  }
  return { sentry, sourcemap: sentry };
}
