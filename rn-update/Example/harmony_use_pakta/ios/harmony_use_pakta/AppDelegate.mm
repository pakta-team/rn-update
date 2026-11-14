/**
 * [INPUT]: 依赖 AppDelegate.h、RCTBundleURLProvider 与 RN bridge 配置。
 * [OUTPUT]: 实现 iOS RN 启动生命周期，并在 Release 读取 main.jsbundle。
 * [POS]: iOS 宿主 bundle 入口，与 Harmony ArkTS provider 保持同一 JS 资源语义。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
#import "AppDelegate.h"

#import <React/RCTBundleURLProvider.h>

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  self.moduleName = @"harmony_use_pakta";
  // You can add your custom initial props in the dictionary below.
  // They will be passed down to the ViewController used by React Native.
  self.initialProps = @{};

  return [super application:application didFinishLaunchingWithOptions:launchOptions];
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

@end
