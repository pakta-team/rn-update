/**
 * [INPUT]: 依赖 React Native RCTAppDelegate 与 UIKit
 * [OUTPUT]: 对外提供 AwesomeProject AppDelegate 声明
 * [POS]: iOS 宿主启动契约，供 AppDelegate.mm 与 Xcode target 消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
#import <RCTAppDelegate.h>
#import <UIKit/UIKit.h>

@interface AppDelegate : RCTAppDelegate

@end
