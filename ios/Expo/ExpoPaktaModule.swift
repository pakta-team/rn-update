/**
 * [INPUT]: 依赖 ExpoModulesCore 的 Module 与 ModuleDefinition 注册协议
 * [OUTPUT]: 对外提供 ExpoPaktaModule，并注册稳定模块名 ExpoPakta
 * [POS]: Expo Apple 自动发现入口；更新能力由 RCTPakta 桥与 React Delegate Handler 提供
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import ExpoModulesCore

public class ExpoPaktaModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoPakta")
  }
}
