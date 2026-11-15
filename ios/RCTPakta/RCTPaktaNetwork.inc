/**
 * [INPUT]: 依赖 Foundation NSURLSession/dispatch；tvOS Release 另依赖 Network 路径监视与内核进程启动时间
 * [OUTPUT]: 提供禁止 HTTPS 降级的限时 JSON 请求，以及 tvOS 已耗进程时间和最多0.5秒的网络预检
 * [POS]: RCTPakta.mm 的原生检查 IO 边界；RoundEngine 提供请求/时限，Orchestrator 消费启动预检，不拥有重试策略
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
#if TARGET_OS_TV && !DEBUG
#import <Network/Network.h>
#include <sys/sysctl.h>
#include <sys/time.h>
#include <unistd.h>

static const NSTimeInterval kPaktaPurgeRestoreMinimumBudget = 2;

static NSTimeInterval PaktaProcessElapsed(void) {
    struct kinfo_proc info;
    size_t size = sizeof(info);
    int mib[4] = {CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()};
    if (sysctl(mib, 4, &info, &size, NULL, 0) != 0 || size == 0) {
        return 0;
    }
    struct timeval now;
    gettimeofday(&now, NULL);
    const struct timeval start = info.kp_proc.p_starttime;
    NSTimeInterval elapsed = (now.tv_sec - start.tv_sec)
        + (now.tv_usec - start.tv_usec) / 1e6;
    return elapsed > 0 ? elapsed : 0;
}

static BOOL PaktaHasNetworkPath(void) {
    dispatch_queue_t queue = dispatch_queue_create("cn.reactnative.pakta.path", DISPATCH_QUEUE_SERIAL);
    nw_path_monitor_t monitor = nw_path_monitor_create();
    dispatch_semaphore_t answered = dispatch_semaphore_create(0);
    __block nw_path_status_t status = nw_path_status_invalid;
    nw_path_monitor_set_queue(monitor, queue);
    nw_path_monitor_set_update_handler(monitor, ^(nw_path_t path) {
        BOOL first = status == nw_path_status_invalid;
        status = nw_path_get_status(path);
        if (first) {
            dispatch_semaphore_signal(answered);
        }
    });
    nw_path_monitor_start(monitor);
    dispatch_semaphore_wait(answered, dispatch_time(DISPATCH_TIME_NOW,
        (int64_t)(0.5 * NSEC_PER_SEC)));
    nw_path_monitor_cancel(monitor);
    __block nw_path_status_t result;
    dispatch_sync(queue, ^{
        result = status;
    });
    return result != nw_path_status_unsatisfied;
}
#endif

@interface PaktaCheckRequestRedirectGuard : NSObject <NSURLSessionTaskDelegate>
@end

@implementation PaktaCheckRequestRedirectGuard

- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task
willPerformHTTPRedirection:(NSHTTPURLResponse *)response
        newRequest:(NSURLRequest *)request
 completionHandler:(void (^)(NSURLRequest *))completionHandler
{
    NSString *originalScheme = [task.originalRequest.URL.scheme lowercaseString];
    NSString *nextScheme = [request.URL.scheme lowercaseString];
    if ([originalScheme isEqualToString:@"https"] && [nextScheme isEqualToString:@"http"]) {
        completionHandler(nil);
        return;
    }
    completionHandler(request);
}

@end

// Blocking JSON HTTP round-trip on the orchestrator's utility thread. Returns
// the response body on 2xx, nil on any failure. The semaphore timeout is a
// backstop over the request's own timeoutInterval.
static NSString *PaktaHttpRequest(NSString *urlString, NSString *method,
                                  NSString *body, NSTimeInterval timeout,
                                  NSTimeInterval callTimeout) {
    NSURL *url = [NSURL URLWithString:urlString];
    if (url == nil) {
        return nil;
    }
    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
    request.HTTPMethod = method;
    request.timeoutInterval = timeout;
    [request setValue:@"application/json" forHTTPHeaderField:@"Accept"];
    if (body != nil) {
        [request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
        request.HTTPBody = [body dataUsingEncoding:NSUTF8StringEncoding];
    }
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    __block NSString *result = nil;
    // A delegate session (not the shared one) so the redirect guard sees the
    // 3xx before it is followed; the completion handler still receives the
    // final response.
    NSURLSession *session = [NSURLSession
        sessionWithConfiguration:[NSURLSessionConfiguration defaultSessionConfiguration]
                        delegate:[PaktaCheckRequestRedirectGuard new]
                   delegateQueue:nil];
    NSURLSessionDataTask *task = [session dataTaskWithRequest:request
        completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
            NSHTTPURLResponse *httpResponse =
                [response isKindOfClass:[NSHTTPURLResponse class]]
                    ? (NSHTTPURLResponse *)response
                    : nil;
            NSInteger status = httpResponse.statusCode;
            if (error == nil && httpResponse != nil && status >= 200 && status < 300
                && data != nil) {
                result = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
            }
            dispatch_semaphore_signal(sem);
        }];
    [task resume];
    // The session retains its delegate until invalidated: let this one task
    // settle, then release everything.
    [session finishTasksAndInvalidate];
    if (dispatch_semaphore_wait(
            sem, dispatch_time(DISPATCH_TIME_NOW,
                               (int64_t)(callTimeout * NSEC_PER_SEC))) != 0) {
        [task cancel];
        return nil;
    }
    return result;
}
