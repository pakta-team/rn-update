/**
 * [INPUT]: 依赖 Foundation、下载 URL/目标路径、总时限与进度/完成回调
 * [OUTPUT]: 对外提供 RCTPaktaDownloader.download 单文件流式下载入口
 * [POS]: RCTPakta 网络传输端口，向主模块隐藏 NSURLSession delegate、Range 恢复和 sidecar 状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
#import <Foundation/Foundation.h>

// Path of the resume sidecar that records what a partial download at
// `savePath` belongs to (url + validators + total). Shared with the unzip
// step, which must drop it together with the archive it vouches for.
FOUNDATION_EXPORT NSString *RCTPaktaResumeSidecarPath(NSString *savePath);

// Size of the file at `path` in bytes; -1 when it cannot be read.
FOUNDATION_EXPORT long long RCTPaktaFileSize(NSString *path);

// nil when the volume holding `path` can take `bytesToWrite` plus the
// cpp/patch_core/archive_limits.h safety margin (or the free space is
// unknown); the reason otherwise. `path` need not exist yet — the check walks
// up to an existing ancestor.
FOUNDATION_EXPORT NSString *RCTPaktaFreeSpaceShortfall(NSString *path, long long bytesToWrite);

@interface RCTPaktaDownloader : NSObject

+ (void)download:(NSString *)downloadPath savePath:(NSString *)savePath
    timeoutInterval:(NSTimeInterval)timeoutInterval
    progressHandler:(void (^)(long long, long long))progressHandler
completionHandler:(void (^)(NSString *path, NSError *error))completionHandler;

@end
