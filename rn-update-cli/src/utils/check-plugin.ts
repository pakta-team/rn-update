/**
 * [INPUT]: 依赖 fs-helpers 的路径存在探测与本地化文案
 * [OUTPUT]: 对外提供 checkPlugins，以 Sentry 配置文件存在性返回 sentry/sourcemap 开关
 * [POS]: CLI bundle 前置探测边界，并行检查双平台配置并仅提示一次，参数由 bundle 编排消费
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
