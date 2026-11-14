/**
 * [INPUT]: 依赖 rn-update PaktaModule、本地 label 常量与样例 index
 * [OUTPUT]: 对外提供修复 bundle 入口，清除 brick flag 并加载应用
 * [POS]: e2etest §11 救砖实验的修复叶节点，与 entry.brick 成对使用
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
// §11 crash-rescue experiment fix bundle: disarm the brick flag immediately.
import { PaktaModule } from 'rn-update';
import { LOCAL_UPDATE_LABELS } from './localUpdateConfig.ts';

const bundleLabelGlobal = globalThis as typeof globalThis & {
  __RNU_E2E_BUNDLE_LABEL?: string;
};

bundleLabelGlobal.__RNU_E2E_BUNDLE_LABEL = `${LOCAL_UPDATE_LABELS.base}_FIXED`;

PaktaModule.setLocalHashInfo(
  'brickflag',
  JSON.stringify({ state: 'disarmed' })
);

require('../index');
