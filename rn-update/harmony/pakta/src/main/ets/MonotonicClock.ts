/**
 * [INPUT]: 依赖 @kit.BasicServicesKit 的 systemDateTime ACTIVE uptime
 * [OUTPUT]: 对外提供 monotonicNowMs，返回不受墙钟校准和深睡影响的单调毫秒时间
 * [POS]: Harmony 截止时间基础设施，与 iOS systemUptime/Android monotonic clock 保持语义同构
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { systemDateTime } from '@kit.BasicServicesKit';

// Absolute deadlines must not use Date.now(): automatic time synchronization
// can move the wall clock while the cold-start rescue round is running.
//
// TimeType.ACTIVE (not STARTUP) is the semantic match for the other two
// platforms: iOS NSProcessInfo.systemUptime and Android System.nanoTime both
// stop during deep sleep, so a device that sleeps mid-download resumes with
// its budget intact. STARTUP keeps counting through sleep and would abort a
// rescue that the same network completes on iOS/Android.
export function monotonicNowMs(): number {
  return systemDateTime.getUptime(systemDateTime.TimeType.ACTIVE);
}
