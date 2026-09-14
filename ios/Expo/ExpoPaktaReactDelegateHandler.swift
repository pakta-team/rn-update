/**
 * [INPUT]: 依赖 ExpoModulesCore/React 启动生命周期、DEBUG/EXPO_SUPPORTS_BUNDLEURL 编译条件与 RCTPakta.bundleURL
 * [OUTPUT]: 对外提供 ExpoPaktaReactDelegateHandler，兼容新 bundleURL 回调和旧 createBridge 构造路径，并按构建模式选择 Metro 或热更 bundle
 * [POS]: Expo Apple 启动适配器；Release 把 bundle 选择委托给 iOS 更新核心，Debug 保留 Expo/Metro 的桥接委托
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import ExpoModulesCore
import React

public final class ExpoPaktaReactDelegateHandler: ExpoReactDelegateHandler {
    private func resolvedBundleURL() -> URL? {
      #if DEBUG
      // 开发支持模式交还 Expo/Metro，不能让已有热更文件遮蔽开发服务器。
      return nil
      #else
      RCTPakta.bundleURL()
      #endif
    }

    #if EXPO_SUPPORTS_BUNDLEURL
    override public func bundleURL(reactDelegate: ExpoReactDelegate) -> URL? {
      resolvedBundleURL()
    }

    #else
    override public func createBridge(reactDelegate: ExpoReactDelegate, bridgeDelegate: RCTBridgeDelegate, launchOptions: [AnyHashable: Any]?) -> RCTBridge? {
      #if DEBUG
      // 开发支持模式沿用 Expo 提供的 delegate，保留 Metro、Fast Refresh 与调试注入。
      RCTBridge(delegate: bridgeDelegate, launchOptions: launchOptions)
      #else
      RCTBridge(bundleURL: resolvedBundleURL(), moduleProvider: nil, launchOptions: launchOptions)
      #endif
    }

    #endif
}
