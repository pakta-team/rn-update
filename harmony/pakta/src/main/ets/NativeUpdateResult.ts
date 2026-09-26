/**
 * [INPUT]: 无外部依赖，仅原生 Promise
 * [OUTPUT]: 对外提供 NativeUpdateResult 接口、nativeUpdateResult() 工厂与 NativeUpdateRound 单飞门（run 复用在途 promise，延迟到 task 存后才调用 operation，含重入）
 * [POS]: Harmony 无桥检查轮的快照与单飞原语；快照语义与 Android NativeUpdateResult.java 同构，NativeUpdateRound 同时服务延迟检查与 PaktaFileJSBundleProvider.checkAndUpdate
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/** A native round snapshot, not the current state of the running RN instance. */
export interface NativeUpdateResult {
  /** skipped, noUpdate, downloaded, failed, or cancelled. */
  status: string;
  reason: string;
  hash: string;
  /** The version was selected for the next launch; no reload is performed. */
  activated: boolean;
}

export function nativeUpdateResult(
  status: string,
  reason: string = '',
  hash: string = '',
  activated: boolean = false,
): NativeUpdateResult {
  return { status, reason, hash, activated };
}

/** Internal gate shared by the delayed check and the native host API. */
export class NativeUpdateRound {
  private task: Promise<NativeUpdateResult> | undefined;

  run(operation: () => Promise<NativeUpdateResult>): Promise<NativeUpdateResult> {
    if (this.task !== undefined) {
      return this.task;
    }
    // Defer invocation until the promise is stored, including reentrant callers.
    this.task = Promise.resolve().then(operation);
    return this.task;
  }
}
