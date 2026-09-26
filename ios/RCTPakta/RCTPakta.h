/**
 * [INPUT]: 依赖 React RCTBridgeModule 与 RCTEventEmitter 公共协议
 * [OUTPUT]: 对外提供 RCTPakta 原生模块声明、启动 bundleURL 类方法，以及无桥宿主 API +configure:completion: 与 +checkAndUpdateWithCompletion:（含两个 completion typedef）
 * [POS]: RCTPakta 最小公共头，React Native、Expo Delegate 与宿主只通过该表面接入 iOS 更新核心
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

typedef void (^RCTPaktaNativeConfigurationCompletion)(NSError * _Nullable error);

typedef void (^RCTPaktaNativeUpdateCompletion)(NSDictionary<NSString *, id> * _Nonnull result);

@interface RCTPakta : RCTEventEmitter<RCTBridgeModule>

+ (NSURL *)bundleURL;

/** Validate and persist native options without JS, network work or bundle resolution.
 * Completion is on the main queue; nil error means success. Call before the
 * normal launch bundle resolution for first-install native-only provisioning.
 */
+ (void)configure:(NSDictionary<NSString *, id> * _Nonnull)options
       completion:(RCTPaktaNativeConfigurationCompletion _Nullable)completion
    NS_SWIFT_NAME(configure(_:completion:));

/**
 * Start, join, or reuse this process's native update round. Call after the
 * host's real bundleURL resolution; this method never resolves the bundle
 * again, reloads React Native, or displays UI. Configuration is the one
 * persisted by the JS SDK. The optional completion runs on the main queue.
 *
 * Result keys: status (skipped/noUpdate/downloaded/failed/cancelled), reason,
 * hash (empty when nothing was installed), activated (selected for NEXT
 * launch, not a reload of the running instance).
 */
+ (void)checkAndUpdateWithCompletion:(RCTPaktaNativeUpdateCompletion _Nullable)completion
    NS_SWIFT_NAME(checkAndUpdate(completion:));

@end
