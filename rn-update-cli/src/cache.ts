/**
 * [INPUT]: 依赖 Hermes base 缓存统计/清理能力与本地化文案
 * [OUTPUT]: 对外提供 cacheCommands，暴露 CLI 缓存查询和清理命令
 * [POS]: CLI 缓存命令适配层，只编排用户输出，不持有缓存实现细节
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { cacheStats, cleanCache } from './utils/hermes-base';
import { t } from './utils/i18n';

export const cacheCommands = {
  cache: async ({ args }: { args?: string[] }) => {
    if (args?.[0] === 'clean') {
      const removed = await cleanCache();
      console.log(t('cacheCleaned', { count: removed }));
      return;
    }
    const stats = await cacheStats();
    console.log(
      t('cacheStats', {
        dir: stats.dir,
        files: stats.files,
        mb: (stats.bytes / 1024 / 1024).toFixed(1),
      }),
    );
  },
};
