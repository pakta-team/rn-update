/**
 * [INPUT]: 依赖 React Native RCTAppDelegate 与 UIKit。
 * [OUTPUT]: 声明 AwesomeProject AppDelegate 宿主代理类型。
 * [POS]: iOS 生命周期接口层，与 AppDelegate.mm 共同承载 bundle 选择。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
#import <RCTAppDelegate.h>
#import <UIKit/UIKit.h>

@interface AppDelegate : RCTAppDelegate

@end
