/**
 * [INPUT]: 依赖 react-native TurboModule 类型与 TurboModuleRegistry，并与 Android/iOS/Harmony 的版本绑定成功确认签名保持同构
 * [OUTPUT]: 对外提供包含 markSuccess(expectedHash) 的 Codegen Spec 接口及可空的 Pakta TurboModule 实例
 * [POS]: src 的新架构桥契约，由 core 按运行时架构装载；只描述边界，不承载更新业务规则
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { type TurboModule, TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  getConstants: () => {
    downloadRootDir: string;
    packageVersion: string;
    currentVersion: string;
    isFirstTime: boolean;
    rolledBackVersion: string;
    buildTime: string;
    channel: string;
    uuid: string;
    isUsingBundleUrl: boolean;
    currentVersionInfo: string;
    supportedDiffVersion: number;
    /**
     * SHA-256 of the running hot-update bundle as recorded by the install
     * (cpp/patch_core/install_record.h); '' for the embedded bundle, legacy
     * installs, or older native modules.
     */
    currentBundleSha256?: string;
  };
  setLocalHashInfo(hash: string, info: string): Promise<void>;
  getLocalHashInfo(hash: string): Promise<string>;
  setUuid(uuid: string): Promise<void>;
  /**
   * Persist the config subset the native cold-start update check consumes
   * (appKey, endpoints, afterDownload policy; NATIVE_CHECKUPDATE_DESIGN
   * §10.1). Stored as a raw JSON string, parsed natively on read. JS is the
   * single config source — a native side without persisted config silently
   * skips its check, which doubles as the feature's rollout gate.
   */
  syncNativeConfig(config: string): Promise<void>;
  /**
   * Raw response cached by the native cold-start check, including the request
   * and config fingerprints that scope reuse (§10.3). Resolves to
   * an empty string when absent; never rejects.
   */
  getNativeCheckCache(): Promise<string>;
  /**
   * JS obtained a valid check response in this process for `config` (the
   * same JSON syncNativeConfig persists). The delayed cold-start round skips
   * its own request when its persisted config matches; a crash-rescue round
   * is unaffected (§10.3). Older native modules lack this method.
   */
  markJsCheckCompleted(config: string): Promise<void>;
  reloadUpdate(options: { hash: string }): Promise<void>;
  restartApp(): Promise<void>;
  setNeedUpdate(options: { hash: string }): Promise<void>;
  markSuccess(expectedHash: string): Promise<boolean>;
  /**
   * sha256 of the JS bundle embedded in the binary (the pdiff source), lazily
   * computed and cached natively. Resolves to an empty string when unknown
   * (debug build, no embedded bundle, hash failure) — never rejects.
   */
  getBundleHash(): Promise<string>;
  resetToPackagedBundle(): Promise<void>;
  downloadPatchFromPpk(options: {
    updateUrl: string;
    hash: string;
    originHash: string;
  }): Promise<void>;
  downloadPatchFromPackage(options: {
    updateUrl: string;
    hash: string;
  }): Promise<void>;
  downloadFullUpdate(options: {
    updateUrl: string;
    hash: string;
  }): Promise<void>;
  downloadAndInstallApk(options: {
    url: string;
    target: string;
    hash: string;
  }): Promise<void>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export default TurboModuleRegistry.get<Spec>('Pakta') as Spec | null;
