/**
 * [INPUT]: 依赖 Foundation JSON/NSError、RCTPaktaNativeConfig.h 与共享 native_config 的 NormalizeConfiguration
 * [OUTPUT]: 提供 RCTPaktaNormalizeNativeConfig，委托 fixedHost=true 校验后按排序键输出 JSON；捕获 NSException 并返回 nil/可选 NSError
 * [POS]: Apple 无桥 configure 的 Foundation 边界适配；白名单/URL 归共享核，错误域 cn.reactnative.pakta，不触更新状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
#import "RCTPaktaNativeConfig.h"
#include "../../cpp/update_flow_core/native_config.h"

static void PaktaConfigInvalid(NSString *message) {
    @throw [NSException exceptionWithName:NSInvalidArgumentException
        reason:[@"Invalid native configuration: " stringByAppendingString:message]
        userInfo:nil];
}

NSString *RCTPaktaNormalizeNativeConfig(NSDictionary *options, NSError **error) {
    @try {
        if (![options isKindOfClass:NSDictionary.class]) {
            PaktaConfigInvalid(@"expected an object");
        }
        if (![NSJSONSerialization isValidJSONObject:options]) {
            PaktaConfigInvalid(@"expected JSON-compatible options");
        }
        NSData *input = [NSJSONSerialization dataWithJSONObject:options options:0 error:nil];
        std::string normalized, why;
        if (!pakta::updateflow::NormalizeConfiguration(
            std::string(static_cast<const char *>(input.bytes), input.length), &normalized, &why, true)) {
            @throw [NSException exceptionWithName:NSInvalidArgumentException
                reason:[NSString stringWithUTF8String:why.c_str()] userInfo:nil];
        }
        NSData *output = [NSData dataWithBytes:normalized.data() length:normalized.size()];
        id result = [NSJSONSerialization JSONObjectWithData:output options:0 error:nil];
        NSData *data = [NSJSONSerialization dataWithJSONObject:result
            options:NSJSONWritingSortedKeys error:error];
        return data == nil ? nil : [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    } @catch (NSException *exception) {
        if (error != NULL) {
            *error = [NSError errorWithDomain:@"cn.reactnative.pakta" code:1 userInfo:@{
                NSLocalizedDescriptionKey: exception.reason ?: @"Invalid native configuration",
                @"PaktaErrorCode": @"INVALID_OPTIONS"
            }];
        }
        return nil;
    }
}
