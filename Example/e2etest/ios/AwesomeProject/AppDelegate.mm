/**
 * [INPUT]: 依赖 AppDelegate.h、RCTPakta、RN bundle URL provider 与 UIKit
 * [OUTPUT]: 对外提供 iOS 应用启动、bundle 选择和 RCTPakta delegate 接入
 * [POS]: e2etest iOS 宿主生命周期实现
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
#import "AppDelegate.h"
#import "RCTPakta.h"

#import <React/RCTBundleURLProvider.h>
#import <ReactAppDependencyProvider/RCTAppDependencyProvider.h>

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  self.moduleName = @"AwesomeProject";
  self.dependencyProvider = [RCTAppDependencyProvider new];
  // You can add your custom initial props in the dictionary below.
  // They will be passed down to the ViewController used by React Native.
  self.initialProps = @{};

  return [super application:application didFinishLaunchingWithOptions:launchOptions];
}

- (NSURL *)bundleURL
{
  #if DEBUG
    // 原先DEBUG这里的写法不作修改(所以DEBUG模式下不可热更新)
    return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
  #else
    return [RCTPakta bundleURL];  // <--  把这里非DEBUG的情况替换为热更新bundle
  #endif
}

@end
