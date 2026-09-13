/**
 * [INPUT]: 依赖 @rnoh/react-native-openharmony/ts 的实际宿主消费面与 common.UIAbilityContext
 * [OUTPUT]: 对外提供 RNInstance、UITurboModuleContext、UITurboModule 与 RNPackage 的最小 ambient 类型
 * [POS]: types RNOH 防腐层，只声明 pakta 使用的成员，阻断完整 vendored 工具链污染 plain tsc
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
// Minimal type stub for the RNOH surface consumed by the pakta sources.
// The vendored RNOH sources in oh_modules do not type-check under plain tsc
// (they rely on ets-loader-injected globals and looser syntax rules), so the
// harmony type check declares just the symbols we actually use. Keep this in
// sync with @rnoh/react-native-openharmony/ts when new symbols are imported.
declare module '@rnoh/react-native-openharmony/ts' {
  import type common from '@ohos.app.ability.common';

  export interface RNInstance {
    emitDeviceEvent(eventName: string, payload: unknown): void;
  }

  export interface UITurboModuleContext {
    uiAbilityContext: common.UIAbilityContext;
    rnInstance: RNInstance;
    isDebugModeEnabled: boolean;
  }

  export class UITurboModule {
    protected ctx: UITurboModuleContext;
    constructor(ctx: UITurboModuleContext);
  }

  export abstract class RNPackage {
    getUITurboModuleFactoryByNameMap(): Map<
      string,
      (ctx: UITurboModuleContext) => UITurboModule | null
    >;
  }
}
