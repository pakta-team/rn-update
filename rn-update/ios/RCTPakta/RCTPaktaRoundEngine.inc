/**
 * [INPUT]: 依赖主编译单元的共享 StepRound、身份/状态、HTTP、安装及下载协作者和单调时钟
 * [OUTPUT]: 提供 RCTPaktaOrchestrator 的环境/命令适配与 runOnce 循环，回传真实 committed.activated
 * [POS]: 仅由 RCTPakta.mm 包含的 Apple 共享轮次执行片段，保留救援/tvOS 标志与本地提交边界，不复制策略
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
+ (flowjson::Value)launchEnv:(NSString *)rolledBack {
    __block NSString *current = nil;
    PaktaWithStateLock(^{
        current = PaktaFromStdString(PaktaStateFromDefaults(PaktaDefaults()).current_version);
    });
    flowjson::Value env = flowjson::Value::Object();
    const auto put = [&env](const char *key, NSString *value) {
        if (value != nil) env.Set(key, flowjson::Value::String(PaktaToStdString(value)));
    };
    put("packageVersion", [RCTPakta packageVersion]);
    put("currentVersion", current);
    put("channel", [RCTPakta channel]);
    put("uuid", [PaktaDefaults() stringForKey:keyUuid]);
    put("rolledBackVersion", rolledBack);
    put("buildTime", [RCTPakta buildTime]);
    put("os", [NSString stringWithFormat:@"%@ %@", PaktaOsName, UIDevice.currentDevice.systemVersion]);
    put("bundleHash", PaktaBundleHashSync(!paktaCrashRescueActive.load()));
    return env;
}

+ (flowjson::Value)downloadCommand:(const flowjson::Value &)command {
    const std::string strategy = command.Get("strategy").AsString();
    PaktaType type = strategy == "diff" ? PaktaTypePatchFromPpk
        : strategy == "pdiff" ? PaktaTypePatchFromPackage : PaktaTypeFullDownload;
    NSTimeInterval deadline = command.Get("deadline").AsNumber() / 1000;
    NSMutableDictionary *options = [@{
        @"updateUrl": PaktaFromStdString(command.Get("url").AsString()) ?: @"",
        @"hash": PaktaFromStdString(command.Get("hash").AsString()) ?: @"",
        @"deadlineUptime": @(deadline),
    } mutableCopy];
    if (type == PaktaTypePatchFromPpk) {
        options[@"originHash"] = PaktaFromStdString(command.Get("originHash").AsString()) ?: @"";
    }
    flowjson::Value event = flowjson::Value::Object();
    event.Set("type", flowjson::Value::String("download"));
    NSTimeInterval remaining = deadline - PaktaMonotonicNow();
    if (remaining <= 0) {
        event.Set("timedOut", flowjson::Value::Bool(true));
        return event;
    }
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    __block NSError *failure = nil;
    [[self engine] performUpdate:type options:options callback:^(NSError *error) {
        failure = error;
        dispatch_semaphore_signal(done);
    }];
    BOOL timedOut = dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW,
        (int64_t)(MAX(0, deadline - PaktaMonotonicNow()) * NSEC_PER_SEC))) != 0;
    event.Set("timedOut", flowjson::Value::Bool(timedOut));
    event.Set("ok", flowjson::Value::Bool(!timedOut && failure == nil));
    if (!timedOut && failure != nil) {
        event.Set("code", flowjson::Value::String(PaktaToStdString(failure.userInfo[PaktaErrorCodeKey])));
    }
    return event;
}

+ (flowjson::Value)commitCommand:(const flowjson::Value &)command {
    const std::string hashText = command.Get("hash").AsString();
    NSString *hash = PaktaFromStdString(hashText);
    NSString *cacheText = PaktaFromStdString(command.Get("cache").AsString());
    NSDictionary *cache = [NSJSONSerialization JSONObjectWithData:
        [cacheText dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
    NSDictionary *entry = nil;
    if (!hashText.empty()) {
        NSString *infoText = PaktaFromStdString(command.Get("hashInfo").AsString());
        NSDictionary *info = [NSJSONSerialization JSONObjectWithData:
            [infoText dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
        entry = @{@"hash": hash, @"info": info ?: @{}};
    }
    BOOL activated = NO;
    BOOL committed = [self commitRoundWithGeneration:(uint64_t)command.Get("resetGeneration").AsNumber()
        hashInfo:entry activate:command.Get("activate").Truthy() ? hash : nil
        responseText:cache[@"body"] request:cache[@"request"] config:cache[@"config"]
        responseAt:[cache[@"ts"] longLongValue] activated:&activated];
    flowjson::Value event = flowjson::Value::Object();
    event.Set("type", flowjson::Value::String("committed"));
    event.Set("ok", flowjson::Value::Bool(committed));
    event.Set("activated", flowjson::Value::Bool(activated));
    if (!committed) {
        BOOL changed = paktaNativeConfigGeneration.load() != paktaHostRoundConfigGeneration;
        BOOL reset = paktaResetGeneration.load() != (uint64_t)command.Get("resetGeneration").AsNumber();
        event.Set("reason", flowjson::Value::String(changed ? "config_changed" : "reset"));
        event.Set("error", flowjson::Value::Bool(!changed && !reset));
    }
    return event;
}

+ (flowjson::Value)performCommand:(const flowjson::Value &)command rolledBack:(NSString *)rolledBack {
    const std::string type = command.Get("type").AsString();
    flowjson::Value event = flowjson::Value::Object();
    if (type == "collectEnv") {
        event.Set("type", flowjson::Value::String("env"));
        event.Set("env", [self launchEnv:rolledBack]);
    } else if (type == "http") {
        BOOL post = command.Get("post").Truthy();
        NSString *text = PaktaHttpRequest(PaktaFromStdString(command.Get("url").AsString()),
            post ? @"POST" : @"GET", post ? PaktaFromStdString(command.Get("body").AsString()) : nil,
            command.Get("timeoutMs").AsNumber() / 1000,
            command.Get("callTimeoutMs").AsNumber() / 1000);
        event.Set("type", flowjson::Value::String("http"));
        if (text != nil) {
            event.Set("text", flowjson::Value::String(PaktaToStdString(text)));
            event.Set("at", flowjson::Value::Number(NSDate.date.timeIntervalSince1970));
        }
    } else if (type == "checkInstalled") {
        NSString *hash = PaktaFromStdString(command.Get("hash").AsString());
        event.Set("type", flowjson::Value::String("installed"));
        event.Set("installed", flowjson::Value::Bool(PaktaHasCompletedVersionAtPath(
            [[RCTPakta downloadDir] stringByAppendingPathComponent:hash], hash)));
    } else if (type == "download") {
        event = [self downloadCommand:command];
    } else if (type == "commit") {
        event = [self commitCommand:command];
    }
    return event;
}

+ (void)runOnce:(NSString *)launchRolledBackVersion deadline:(NSTimeInterval)deadlineUptime {
    const uint64_t generation = paktaResetGeneration.load();
    paktaHostRoundGeneration = generation;
    paktaHostRoundConfigGeneration = paktaNativeConfigGeneration.load();
    NSUserDefaults *defaults = PaktaDefaults();
    NSString *config = [defaults stringForKey:keyNativeConfig];
    paktaHostRoundConfig = [config copy];
    paktaHostRoundResult = PaktaHostResult(@"failed", @"internal_error", nil, NO);
    flowjson::Value event = flowjson::Value::Object();
    event.Set("type", flowjson::Value::String("start"));
    event.Set("config", flowjson::Value::String(PaktaToStdString(config)));
    event.Set("resetGeneration", flowjson::Value::Number(generation));
    event.Set("configGeneration", flowjson::Value::Number(paktaHostRoundConfigGeneration));
    event.Set("sample", flowjson::Value::Number(arc4random() / 4294967296.0));
    event.Set("deadline", flowjson::Value::Number(deadlineUptime > 0 ? deadlineUptime * 1000 : 0));
    flowjson::Value state;
    BOOL marked = NO;
    @try {
        for (;;) {
            event.Set("now", flowjson::Value::Number(PaktaMonotonicNow() * 1000));
            event.Set("crashHold", flowjson::Value::Bool(paktaCrashRescueActive.load()));
            event.Set("forceActivate", flowjson::Value::Bool(paktaPurgeRestoreActive.load()));
            flowjson::Value step = pakta::updateflow::StepRound(state, event);
            state = step.Get("state");
            event = flowjson::Value::Object();
            for (const auto &command : step.Get("commands").elements()) {
                const std::string type = command.Get("type").AsString();
                if (type == "markIncomplete") {
                    [defaults setObject:@YES forKey:keyNativeCheckIncomplete];
                    marked = YES;
                } else if (type == "finish") {
                    NSString *hash = PaktaFromStdString(command.Get("hash").AsString());
                    BOOL activated = command.Get("activated").Truthy();
                    if (hash.length > 0) {
                        @synchronized (self) {
                            paktaUnactivatedHash = activated ? nil : [hash copy];
                            paktaUnactivatedGeneration = generation;
                        }
                    }
                    paktaHostRoundResult = PaktaHostResult(
                        PaktaFromStdString(command.Get("status").AsString()),
                        PaktaFromStdString(command.Get("reason").AsString()), hash, activated);
                    return;
                } else {
                    event = [self performCommand:command rolledBack:launchRolledBackVersion];
                }
            }
        }
    } @finally {
        if (marked) [defaults removeObjectForKey:keyNativeCheckIncomplete];
    }
}
