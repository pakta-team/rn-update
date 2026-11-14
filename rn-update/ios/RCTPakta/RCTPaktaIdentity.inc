+ (NSString *)downloadDir
{
#if TARGET_OS_TV
    // tvOS apps cannot write Application Support; Caches is the only
    // writable, non-temporary location, and the system may purge it while
    // the app is not running (see the purged-version path in +bundleURL).
    NSSearchPathDirectory base = NSCachesDirectory;
#else
    NSSearchPathDirectory base = NSApplicationSupportDirectory;
#endif
    NSString *directory = [NSSearchPathForDirectoriesInDomains(base, NSUserDomainMask, YES) firstObject];
    return [directory stringByAppendingPathComponent:@"rctpakta"];
}

+ (NSURL *)binaryBundleURL
{
    return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
}

+ (NSString *)packageVersion
{
    static NSString *version = nil;

    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        NSDictionary *infoDictionary = [[NSBundle mainBundle] infoDictionary];
        version = [infoDictionary objectForKey:@"CFBundleShortVersionString"];
    });
    return version;
}

+ (NSString *)buildTime
{
#if DEBUG
    return @"0";
#else
    static NSString *buildTime;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        // The podspec's s.resource lands in the app bundle for a static
        // library but inside this pod's own framework bundle under
        // use_frameworks!; look in both.
        NSString *stampPath =
            [[NSBundle mainBundle] pathForResource:@"pakta_build_time" ofType:@"txt"]
            ?: [[NSBundle bundleForClass:[RCTPakta class]] pathForResource:@"pakta_build_time"
                                                                   ofType:@"txt"];
        NSString *stamp = stampPath == nil ? nil
            : [[NSString stringWithContentsOfFile:stampPath encoding:NSUTF8StringEncoding error:nil]
                  stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
        if (stamp.length == 0) {
            // Never empty: with "" SyncBinaryVersion would miss a rebuilt
            // binary that kept its CFBundleShortVersionString, and a stale
            // hot update would outlive an App Store update. A correctly
            // packaged binary always carries the UUID resource; this
            // last-resort value stays opaque rather than exposing a timestamp.
            RCTLogWarn(@"RCTPakta -- pakta_build_time.txt %@; using a generated UUID as buildTime",
                       stampPath == nil ? @"not found in the main or framework bundle" : @"is empty");
            stamp = [[[NSUUID UUID] UUIDString] lowercaseString];
        }
        buildTime = stamp;
    });
    return buildTime;
#endif
}

+ (NSString *)channel
{
    static NSString *channel;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        id value = [[[NSBundle mainBundle] infoDictionary] objectForKey:@"channel"];
        channel = [value isKindOfClass:[NSString class]] && [value length] > 0
            ? [value stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]]
            : @"default";
        if (channel.length == 0) channel = @"default";
    });
    return channel;
}

