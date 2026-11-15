/**
 * [INPUT]: 依赖 entry.fix 的修复入口与 PaktaModule 的原生 hashInfo 读取
 * [OUTPUT]: 提供真坏 JS 救援修复 bundle，并输出由原生提交的 crashRescue 证明
 * [POS]: Android/iOS §11 验收专用叶节点；复用正常修复入口，不通过 JS 构造救援标记
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { PaktaModule } from 'rn-update';
import './entry.fix';

const rescuedHash = 'e2e-rescue-fix';
PaktaModule.getLocalHashInfo(rescuedHash).then((raw: string) => {
  const hashInfo = JSON.parse(raw || '{}') as { crashRescue?: boolean };
  console.warn(
    `PAKTA_CRASH_RESCUE_PROOF ${JSON.stringify({
      hash: rescuedHash,
      crashRescue: hashInfo.crashRescue === true,
      hashInfo,
    })}`
  );
});
