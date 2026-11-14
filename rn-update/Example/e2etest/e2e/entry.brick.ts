/**
 * [INPUT]: 依赖 rn-update PaktaModule、本地 label 常量与样例 index
 * [OUTPUT]: 对外提供故障 bundle 入口，按持久 flag 模拟启动崩溃
 * [POS]: e2etest §11 救砖实验的故障注入叶节点，仅供原生救援套件消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
// §11 crash-rescue experiment (not part of the regular e2e suites): the first
// healthy launch arms a flag well after markSuccess; every later launch reads
// it and dies a few hundred ms in.
import { PaktaModule } from 'rn-update';
import { LOCAL_UPDATE_LABELS } from './localUpdateConfig.ts';

const bundleLabelGlobal = globalThis as typeof globalThis & {
  __RNU_E2E_BUNDLE_LABEL?: string;
};

bundleLabelGlobal.__RNU_E2E_BUNDLE_LABEL = `${LOCAL_UPDATE_LABELS.base}_BRICK`;

PaktaModule.getLocalHashInfo('brickflag').then((v: string) => {
  if (v?.includes('armed') && !v.includes('disarmed')) {
    setTimeout(() => {
      throw new Error('BRICK: crash on launch');
    }, 0);
  } else {
    setTimeout(() => {
      PaktaModule.setLocalHashInfo(
        'brickflag',
        JSON.stringify({ state: 'armed' })
      );
      console.warn('brick armed for next launch');
    }, 8000);
  }
});

require('../index');
