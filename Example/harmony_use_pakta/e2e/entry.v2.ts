/**
 * [INPUT]: 依赖 localUpdateConfig 的 ppkPatch 标签与 entry.base 注册逻辑。
 * [OUTPUT]: 写入 E2E_PPK_PATCH_V2 bundle label 并复用基线入口。
 * [POS]: Harmony ppk diff 更新轨道的确定性 bundle 入口。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { LOCAL_UPDATE_LABELS } from './localUpdateConfig';

const bundleLabelGlobal = globalThis as typeof globalThis & {
  __RNU_E2E_BUNDLE_LABEL?: string;
};

bundleLabelGlobal.__RNU_E2E_BUNDLE_LABEL = LOCAL_UPDATE_LABELS.ppkPatch;
require('./entry.base');
