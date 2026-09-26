/**
 * [INPUT]: 依赖 Foundation 的 NSRegularExpression/NSJSONSerialization/NSError 与 RCTPaktaNativeConfig.h 的导出契约
 * [OUTPUT]: 对外提供 RCTPaktaNormalizeNativeConfig：非法选项抛 NSInvalidArgumentException 或 NSError(cn.reactnative.pakta, 1)，合法返回 NSJSONWritingSortedKeys 幂等 JSON 快照
 * [POS]: iOS 无桥宿主配置的纯校验器，被 RCTPakta.configure 调用；不触任何更新状态，与 Android/Harmony 归一化器三端镜像同构
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
#import "RCTPaktaNativeConfig.h"

static void PaktaConfigInvalid(NSString *message) {
    @throw [NSException exceptionWithName:NSInvalidArgumentException
        reason:[@"Invalid native configuration: " stringByAppendingString:message]
        userInfo:nil];
}

static NSString *PaktaConfigString(id value, NSString *name, BOOL allowEmpty) {
    if (![value isKindOfClass:NSString.class]
        || (!allowEmpty && [[value stringByTrimmingCharactersInSet:
            NSCharacterSet.whitespaceAndNewlineCharacterSet] length] == 0)) {
        PaktaConfigInvalid([NSString stringWithFormat:@"%@ must be a string%@",
            name, allowEmpty ? @"" : @" and must not be blank"]);
    }
    return value;
}

static NSArray *PaktaConfigUrls(id value, NSString *name, BOOL base) {
    if (![value isKindOfClass:NSArray.class] || (base && [value count] == 0)) {
        PaktaConfigInvalid([NSString stringWithFormat:@"%@ must be %@ array",
            name, base ? @"a non-empty" : @"an"]);
    }
    NSMutableArray *result = [NSMutableArray array];
    NSRegularExpression *authority = [NSRegularExpression regularExpressionWithPattern:
        @"^https?://(\\[[0-9a-fA-F:]+\\]|[a-zA-Z0-9.-]+)(:[0-9]+)?([/?#]|$)"
        options:0 error:nil];
    for (id item in value) {
        NSString *url = [PaktaConfigString(item, name, NO) stringByTrimmingCharactersInSet:
            NSCharacterSet.whitespaceAndNewlineCharacterSet];
        if ([authority firstMatchInString:url options:0 range:NSMakeRange(0, url.length)] == nil
            || [url rangeOfCharacterFromSet:NSCharacterSet.whitespaceAndNewlineCharacterSet].location != NSNotFound
            || [url containsString:@"\\"]
            || (base && ([url containsString:@"?"] || [url containsString:@"#"]))) {
            PaktaConfigInvalid([NSString stringWithFormat:
                @"%@ requires absolute HTTP(S) URLs without credentials%@",
                name, base ? @", queries or fragments" : @""]);
        }
        if (base) {
            while ([url hasSuffix:@"/"]) {
                url = [url substringToIndex:url.length - 1];
            }
        }
        if (![result containsObject:url]) {
            [result addObject:url];
        }
    }
    return result;
}

NSString *RCTPaktaNormalizeNativeConfig(NSDictionary *options, NSError **error) {
    @try {
        if (![options isKindOfClass:NSDictionary.class]) {
            PaktaConfigInvalid(@"expected an object");
        }
        NSArray *keys = @[@"appKey", @"endpoints", @"queryUrls", @"afterDownload",
                           @"disabled", @"packageVersion", @"rnu", @"rn"];
        for (id key in options) {
            if (![keys containsObject:key]) {
                PaktaConfigInvalid([NSString stringWithFormat:@"unknown option %@", key]);
            }
        }
        NSString *appKey = PaktaConfigString(options[@"appKey"], @"appKey", NO);
        BOOL customEndpoints = options[@"endpoints"] != nil;
        NSArray *endpoints = PaktaConfigUrls(customEndpoints ? options[@"endpoints"]
            : @[@"https://pakta.yoghourt.space/api"],
            @"endpoints", YES);
        NSArray *queryUrls = PaktaConfigUrls(options[@"queryUrls"] ?: (customEndpoints ? @[]
            : @[@"https://cdn.jsdelivr.net/gh/pakta-team/rn-update@main/endpoints.json"]),
            @"queryUrls", NO);
        NSString *afterDownload = options[@"afterDownload"]
            ? PaktaConfigString(options[@"afterDownload"], @"afterDownload", NO) : @"none";
        if (![@[@"none", @"setNeedUpdate"] containsObject:afterDownload]) {
            PaktaConfigInvalid(@"afterDownload must be none or setNeedUpdate");
        }
        id disabled = options[@"disabled"] ?: @NO;
        if (![disabled isKindOfClass:NSNumber.class] || CFGetTypeID((__bridge CFTypeRef)disabled) != CFBooleanGetTypeID()) {
            PaktaConfigInvalid(@"disabled must be a boolean");
        }
        NSMutableDictionary *result = [@{
            @"appKey": appKey, @"endpoints": endpoints, @"queryUrls": queryUrls,
            @"afterDownload": afterDownload, @"disabled": disabled,
            @"rnu": options[@"rnu"] ? PaktaConfigString(options[@"rnu"], @"rnu", YES) : @"",
            @"rn": options[@"rn"] ? PaktaConfigString(options[@"rn"], @"rn", YES) : @""
        } mutableCopy];
        if (options[@"packageVersion"] != nil) {
            result[@"packageVersion"] = PaktaConfigString(options[@"packageVersion"], @"packageVersion", NO);
        }
        // Stable ordering makes repeated identical configure calls idempotent.
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
