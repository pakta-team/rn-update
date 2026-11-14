/**
 * [INPUT]: 依赖 RNOH RNApp/Ability 上下文、PaktaFileJSBundleProvider、Metro provider 与 rawfile ResourceManager。
 * [OUTPUT]: 导出 ArkUI Index 页面，创建 RNApp、注册包并按环境选择 JS bundle provider。
 * [POS]: Harmony 运行时根容器；决定更新文件、Metro 调试包与内置 rawfile 的优先级。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { PaktaFileJSBundleProvider } from 'pakta';
import { ComponentBuilderContext, RNOHCoreContext,RNAbility,
  MetroJSBundleProvider } from '@rnoh/react-native-openharmony';
import {
  RNApp,
  AnyJSBundleProvider,
  ResourceJSBundleProvider,
  TraceJSBundleProviderDecorator,
} from '@rnoh/react-native-openharmony'
import { createRNPackages } from '../RNPackagesFactory'
import preferences from '@ohos.data.preferences';

const arkTsComponentNames: Array<string> = [];

@Builder
export function buildCustomRNComponent(ctx: ComponentBuilderContext) {
  // There seems to be a problem with the placement of ArkTS components in mixed mode. Nested Stack temporarily avoided.
  Stack() {
  }
  .position({ x: 0, y: 0 })
}


const wrappedCustomRNComponentBuilder = wrapBuilder(buildCustomRNComponent)

@Entry
@Component
struct Index {
  @StorageLink('RNOHCoreContext') private rnohCoreContext: RNOHCoreContext | undefined = undefined
  @State shouldShow: boolean = false

  aboutToAppear(): void {
    this.shouldShow = true
  }

  onBackPress(): boolean | undefined {
    // NOTE: this is required since `Ability`'s `onBackPressed` function always
    // terminates or puts the app in the background, but we want Ark to ignore it completely
    // when handled by RN
    this.rnohCoreContext!.dispatchBackPress()

    // this.preferences = preferences.getPreferencesSync(this.context, {name:'update'});
    return true
  }

  build() {
    Column() {
      if (this.rnohCoreContext && this.shouldShow) {
        RNApp({
          rnInstanceConfig: {
            createRNPackages,
            enableNDKTextMeasuring: true,
            enableBackgroundExecutor: false,
            enableCAPIArchitecture: true,
            arkTsComponentNames: arkTsComponentNames,
          },
          appKey: "harmony_use_pakta",
          wrappedCustomRNComponentBuilder: wrappedCustomRNComponentBuilder,
          onSetUp: (rnInstance) => {
            rnInstance.enableFeatureFlag("ENABLE_RN_INSTANCE_CLEAN_UP")
          },
          jsBundleProvider: new TraceJSBundleProviderDecorator(
            new AnyJSBundleProvider([
              // local debug mode
              new MetroJSBundleProvider(),
              // release mode
              new PaktaFileJSBundleProvider(this.rnohCoreContext.uiAbilityContext),
              new ResourceJSBundleProvider(this.rnohCoreContext.uiAbilityContext.resourceManager, 'bundle.harmony.js')
            ]),
            this.rnohCoreContext.logger),
        })
      }
    }
    .height('100%')
    .width('100%')
  }
}
