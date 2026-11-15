/**
 * [INPUT]: 依赖 core 的固定 channel、客户端身份与原生配置桥，动态读取 Pakta 配置和有效包版本
 * [OUTPUT]: 对外提供 NativeConfigSync，归一化配置并串行同步最新待写快照与检查完成信号
 * [POS]: src 的原生配置同步边界；尊重 nativeConfigSource 归属，避免失效或不完整 JS 配置覆盖原生救援配置
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { Platform } from 'react-native';
import type { Pakta } from './client';
import { channel, cInfo, PaktaModule } from './core';
import { log } from './utils';

type NativeConfigHost = Pick<Pakta, 'options' | 'getEffectivePackageVersion'>;

export class NativeConfigSync {
  private syncedNativeConfigJson?: string;
  private pendingNativeConfigJson?: string;
  private nativeConfigSyncInFlight = false;

  constructor(private readonly host: NativeConfigHost) {}

  getNativeConfig = (): Record<string, unknown> | undefined => {
    if (
      Platform.OS === 'web' ||
      typeof PaktaModule.syncNativeConfig !== 'function'
    ) {
      return undefined;
    }
    const {
      appKey,
      server,
      updateStrategy,
      checkStrategy,
      disableNativeCheck,
    } = this.host.options;
    if (disableNativeCheck) {
      return { disabled: true, appKey, rnu: cInfo.rnu, rn: cInfo.rn };
    }
    if (!appKey || !server?.main?.length) {
      return undefined;
    }
    const autoCheckEnabled = checkStrategy != null;
    return {
      appKey,
      channel,
      packageVersion: this.host.getEffectivePackageVersion(),
      endpoints: server.main,
      queryUrls: server.queryUrls ?? [],
      afterDownload:
        autoCheckEnabled &&
        (updateStrategy === 'silentAndNow' ||
          updateStrategy === 'silentAndLater')
          ? 'setNeedUpdate'
          : 'none',
      rnu: cInfo.rnu,
      rn: cInfo.rn,
    };
  };

  private getNativeConfigJson = (): string | undefined => {
    const config = this.getNativeConfig();
    return config ? JSON.stringify(config) : undefined;
  };

  private flushNativeConfig = () => {
    if (this.host.options.nativeConfigSource === 'native') {
      this.pendingNativeConfigJson = undefined;
      return;
    }
    if (this.nativeConfigSyncInFlight) {
      return;
    }
    const configJson = this.pendingNativeConfigJson;
    this.pendingNativeConfigJson = undefined;
    if (!configJson || configJson === this.syncedNativeConfigJson) {
      return;
    }
    this.nativeConfigSyncInFlight = true;
    let syncResult: Promise<void>;
    try {
      syncResult = Promise.resolve(PaktaModule.syncNativeConfig(configJson));
    } catch (e: any) {
      this.nativeConfigSyncInFlight = false;
      log('syncNativeConfig failed:', e?.message || e);
      return;
    }
    syncResult
      .then(() => {
        this.syncedNativeConfigJson = configJson;
      })
      .catch((e: any) => {
        log('syncNativeConfig failed:', e?.message || e);
      })
      .finally(() => {
        this.nativeConfigSyncInFlight = false;
        this.flushNativeConfig();
      });
  };

  markJsCheckCompleted = () => {
    if (
      Platform.OS === 'web' ||
      typeof PaktaModule.markJsCheckCompleted !== 'function'
    ) {
      return;
    }
    const configJson = this.getNativeConfigJson();
    if (!configJson) {
      return;
    }
    try {
      Promise.resolve(PaktaModule.markJsCheckCompleted(configJson)).catch(
        (e: any) => {
          log('markJsCheckCompleted failed:', e?.message || e);
        }
      );
    } catch (e: any) {
      log('markJsCheckCompleted failed:', e?.message || e);
    }
  };

  syncNativeConfig = () => {
    if (this.host.options.nativeConfigSource === 'native') {
      this.pendingNativeConfigJson = undefined;
      return;
    }
    if (
      Platform.OS === 'web' ||
      typeof PaktaModule.syncNativeConfig !== 'function'
    ) {
      return;
    }
    const configJson = this.getNativeConfigJson();
    if (!configJson) {
      log('native check config unusable, keeping the last synced config');
      return;
    }
    this.pendingNativeConfigJson = configJson;
    this.flushNativeConfig();
  };
}
