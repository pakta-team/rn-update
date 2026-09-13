/**
 * [INPUT]: 依赖 Expo Modules Kotlin Module 与 ModuleDefinition 注册 DSL
 * [OUTPUT]: 对外提供 ExpoPaktaModule，并注册稳定模块名 ExpoPakta
 * [POS]: Expo Android 模块发现入口；更新能力由共享 React Native 桥和 ExpoPaktaPackage 的宿主钩子提供
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
package expo.modules.pakta

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ExpoPaktaModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoPakta")
  }
}
