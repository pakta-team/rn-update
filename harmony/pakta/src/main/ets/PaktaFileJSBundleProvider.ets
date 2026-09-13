/**
 * [INPUT]: 依赖 RNOH JSBundleProvider、UIAbilityContext、file system 和 UpdateContext 的 bundle 选择
 * [OUTPUT]: 对外提供 PaktaFileJSBundleProvider.getURL/getBundle/getAppKeys
 * [POS]: Harmony bundle 生命周期适配器，负责把已选版本文件交给 RNOH，不执行下载或切包
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

  getAppKeys(): string[] {
    return [];
  }
}
