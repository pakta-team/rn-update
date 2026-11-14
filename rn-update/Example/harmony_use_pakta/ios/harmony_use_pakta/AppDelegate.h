/**
 * [INPUT]: 依赖 React Native RCTAppDelegate 与 UIKit。
 * [OUTPUT]: 声明 harmony_use_pakta iOS AppDelegate。
 * [POS]: iOS RN 宿主接口层，与实现文件共同决定 Debug/Release bundle 来源。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
#import <RCTAppDelegate.h>
#import <UIKit/UIKit.h>

@interface AppDelegate : RCTAppDelegate

@end
