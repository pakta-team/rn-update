/**
 * [INPUT]: 依赖 UIKit 与 harmony_use_pakta AppDelegate。
 * [OUTPUT]: 启动 UIApplicationMain。
 * [POS]: iOS 进程最外层入口，不承担更新逻辑。
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
