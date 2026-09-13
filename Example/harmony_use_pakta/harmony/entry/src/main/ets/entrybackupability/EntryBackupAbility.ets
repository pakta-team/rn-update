/**
 * [INPUT]: 依赖 Harmony BackupExtensionAbility、BundleVersion 与 hilog。
 * [OUTPUT]: 提供备份/恢复扩展回调，记录 bundle 版本信息。
 * [POS]: Harmony 系统备份边界，与 RN 更新状态解耦，仅保留宿主生命周期钩子。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { hilog } from '@kit.PerformanceAnalysisKit';
import { BackupExtensionAbility, BundleVersion } from '@kit.CoreFileKit';

export default class EntryBackupAbility extends BackupExtensionAbility {
  async onBackup() {
    hilog.info(0x0000, 'testTag', 'onBackup ok');
  }

  async onRestore(bundleVersion: BundleVersion) {
    hilog.info(0x0000, 'testTag', 'onRestore ok %{public}s', JSON.stringify(bundleVersion));
  }
}
