/**
 * [INPUT]: 依赖 localUpdateConfig 的 v2Track 标签与 entry.base 注册逻辑。
 * [OUTPUT]: 写入 E2E_V2TRACK_V4 bundle label 并复用基线入口。
 * [POS]: Harmony v2-track diff 更新轨道的确定性 bundle 入口。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { LOCAL_UPDATE_LABELS } from './localUpdateConfig';

const bundleLabelGlobal = globalThis as typeof globalThis & {
  __RNU_E2E_BUNDLE_LABEL?: string;
};

bundleLabelGlobal.__RNU_E2E_BUNDLE_LABEL = LOCAL_UPDATE_LABELS.v2Track;
require('./entry.base');
