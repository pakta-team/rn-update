/**
 * [INPUT]: 依赖 UIKit 与 AwesomeProject AppDelegate。
 * [OUTPUT]: 启动 UIApplicationMain，并把生命周期交给 AppDelegate。
 * [POS]: iOS 进程最外层入口，不处理更新协议。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
#import <UIKit/UIKit.h>

#import "AppDelegate.h"

int main(int argc, char *argv[])
{
  @autoreleasepool {
    return UIApplicationMain(argc, argv, nil, NSStringFromClass([AppDelegate class]));
  }
}
