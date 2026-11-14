/**
 * [INPUT]: 无外部依赖，仅 TypeScript 类型与纯判定函数
 * [OUTPUT]: 对外提供 HermesFuzzSummary 类型与 hermesFuzzSucceeded 终局判定
 * [POS]: scripts 的模糊测试结果裁决器，被 fuzz-hermes-base.ts 与 hermes-review-regressions.test.ts 共享
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

export interface HermesFuzzSummary {
  rounds: number;
  equivalent: number;
  different: number;
  dumpFailed: number;
  compileErrors: number;
  planted: number;
  plantedMissed: number;
  plantedCompileErrors: number;
}

/** A green run must contain all requested comparisons and an effective negative. */
export function hermesFuzzSucceeded(summary: HermesFuzzSummary): boolean {
  return (
    Number.isSafeInteger(summary.rounds) &&
    summary.rounds > 0 &&
    summary.equivalent === summary.rounds &&
    summary.different === 0 &&
    summary.dumpFailed === 0 &&
    summary.compileErrors === 0 &&
    Number.isSafeInteger(summary.planted) &&
    summary.planted > 0 &&
    summary.plantedMissed === 0 &&
    summary.plantedCompileErrors === 0
  );
}
