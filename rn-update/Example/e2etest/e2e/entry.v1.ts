/**
 * [INPUT]: 依赖 localUpdateConfig 的 full label 与样例 index
 * [OUTPUT]: 对外提供 full 更新基线 bundle 入口并写入全局 label
 * [POS]: e2etest 本地制品链的 v1 bundle 叶节点
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { LOCAL_UPDATE_LABELS } from './localUpdateConfig.ts';

const bundleLabelGlobal = globalThis as typeof globalThis & {
  __RNU_E2E_BUNDLE_LABEL?: string;
};

bundleLabelGlobal.__RNU_E2E_BUNDLE_LABEL = LOCAL_UPDATE_LABELS.full;
require('../index');
