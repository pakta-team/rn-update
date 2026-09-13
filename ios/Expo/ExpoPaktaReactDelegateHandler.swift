/**
 * [INPUT]: 依赖 ExpoModulesCore/React 启动生命周期、EXPO_SUPPORTS_BUNDLEURL 编译条件与 RCTPakta.bundleURL
 * [OUTPUT]: 对外提供 ExpoPaktaReactDelegateHandler，兼容新 bundleURL 回调和旧 createBridge 构造路径
 * [POS]: Expo Apple 启动适配器，把不同 Expo 版本的 bundle 选择统一委托给 iOS 更新核心
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import ExpoModulesCore
import React

public final class ExpoPaktaReactDelegateHandler: ExpoReactDelegateHandler {
    private func resolvedBundleURL() -> URL? {
      RCTPakta.bundleURL()
    }

    #if EXPO_SUPPORTS_BUNDLEURL
    override public func bundleURL(reactDelegate: ExpoReactDelegate) -> URL? {
      resolvedBundleURL()
    }

    #else
    override public func createBridge(reactDelegate: ExpoReactDelegate, bridgeDelegate: RCTBridgeDelegate, launchOptions: [AnyHashable: Any]?) -> RCTBridge? {
      RCTBridge(bundleURL: resolvedBundleURL(), moduleProvider: nil, launchOptions: launchOptions)
    }

    #endif
}
