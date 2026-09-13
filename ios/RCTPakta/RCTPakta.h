/**
 * [INPUT]: 依赖 React RCTBridgeModule 与 RCTEventEmitter 公共协议
 * [OUTPUT]: 对外提供 RCTPakta 原生模块声明和启动 bundleURL 类方法
 * [POS]: RCTPakta 最小公共头，React Native、Expo Delegate 与宿主只通过该表面接入 iOS 更新核心
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>


@interface RCTPakta : RCTEventEmitter<RCTBridgeModule>

+ (NSURL *)bundleURL;

@end
