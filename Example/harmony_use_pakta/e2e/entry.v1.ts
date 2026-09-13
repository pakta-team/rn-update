/**
 * [INPUT]: 依赖 localUpdateConfig 的 full 标签与 entry.base 注册逻辑。
 * [OUTPUT]: 先写入 E2E_FULL_V1 bundle label，再转交基线 AppRegistry 入口。
 * [POS]: Harmony 本地 full 更新制品的确定性 bundle 入口。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { LOCAL_UPDATE_LABELS } from './localUpdateConfig';

const bundleLabelGlobal = globalThis as typeof globalThis & {
  __RNU_E2E_BUNDLE_LABEL?: string;
};

bundleLabelGlobal.__RNU_E2E_BUNDLE_LABEL = LOCAL_UPDATE_LABELS.full;
require('./entry.base');
