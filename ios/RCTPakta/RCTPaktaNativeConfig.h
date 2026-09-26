/**
 * [INPUT]: 依赖 Foundation 的 NSDictionary/NSString/NSError
 * [OUTPUT]: 对外提供 RCTPaktaNormalizeNativeConfig(options, error)，校验并快照宿主 options，返回排序键 JSON 字符串
 * [POS]: iOS 无桥宿主配置的校验门面声明，实现位于 RCTPaktaNativeConfig.mm；与 Android NativeUpdateConfig.java、Harmony NativeUpdateConfig.ts 三端镜像同构
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
#import <Foundation/Foundation.h>

// Validates and snapshots host options without changing any update state.
FOUNDATION_EXPORT NSString * _Nullable RCTPaktaNormalizeNativeConfig(
    NSDictionary * _Nonnull options, NSError * _Nullable * _Nullable error);
