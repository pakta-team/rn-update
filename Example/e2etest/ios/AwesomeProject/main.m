/**
 * [INPUT]: 依赖 UIKit 与 AwesomeProject AppDelegate
 * [OUTPUT]: 对外提供 UIApplicationMain 进程入口
 * [POS]: e2etest iOS 原生最外层启动叶节点
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
