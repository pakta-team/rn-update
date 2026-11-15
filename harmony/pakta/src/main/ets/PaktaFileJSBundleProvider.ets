/**
 * [INPUT]: 依赖 RNOH JSBundleProvider、UIAbilityContext、file system、UpdateContext 的 bundle 选择与 NativeCheckOrchestrator.checkAndUpdateNative
 * [OUTPUT]: 对外提供 PaktaFileJSBundleProvider.getURL/getBundle/getAppKeys，以及无桥宿主 configure(options) 与 checkAndUpdate(timeoutMs?)；期限仅限制调用方等待，返回 NativeUpdateResult
 * [POS]: Harmony bundle 生命周期适配器兼无桥宿主门面，负责把已选版本文件交给 RNOH，不执行下载或切包
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {
  FileJSBundle,
  JSBundleProvider,
  JSBundleProviderError,
} from '@rnoh/react-native-openharmony';
import common from '@ohos.app.ability.common';
import fs from '@ohos.file.fs';
import { UpdateContext } from './UpdateContext';
import { checkAndUpdateNative } from './NativeCheckOrchestrator';
import type { NativeUpdateResult } from './NativeUpdateResult';
import { normalizeNativeUpdateConfig } from './NativeUpdateConfig';
import type { NativeUpdateConfig } from './NativeUpdateConfig';

export class PaktaFileJSBundleProvider extends JSBundleProvider {
  private updateContext: UpdateContext;

  constructor(context: common.UIAbilityContext) {
    super();
    this.updateContext = UpdateContext.getInstance(context);
  }

  getURL(): string {
    return this.updateContext.getBundleUrl();
  }

  async getBundle(): Promise<FileJSBundle> {
    const path = this.updateContext.getBundleUrl();
    if (!path) {
      throw new JSBundleProviderError({
        whatHappened: 'No pakta bundle found. using default bundle',
        howCanItBeFixed: [''],
      });
    }
    try {
      await fs.access(path, fs.OpenMode.READ_ONLY);
      return {
        filePath: path,
      };
    } catch (error) {
      throw new JSBundleProviderError({
        whatHappened: `Couldn't load JSBundle from ${path}`,
        extraData: error,
        howCanItBeFixed: [
          `Check if a bundle exists at "${path}" on your device.`,
        ],
      });
    }
  }

  /** Configure before normal bundle resolution; no JS or network work is required. */
  async configure(options: NativeUpdateConfig): Promise<void> {
    const config = normalizeNativeUpdateConfig(options);
    await this.updateContext.setNativeConfig(config);
  }

  /** 真实 bundle 选择后调用；超时仅返回 failed/timeout，轮次继续且不会重载当前实例。 */
  checkAndUpdate(timeoutMs?: number): Promise<NativeUpdateResult> {
    return checkAndUpdateNative(this.updateContext, timeoutMs);
  }

  getAppKeys(): string[] {
    return [];
  }
}
