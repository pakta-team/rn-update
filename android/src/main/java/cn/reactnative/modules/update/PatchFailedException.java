/**
 * [INPUT]: 依赖 IOException 与 DownloadTask 对下载阶段/补丁阶段的失败分类
 * [OUTPUT]: 对内提供 PatchFailedException，标记解包、hdiff 或资源复制失败
 * [POS]: Android 失败语义边界，使 UpdateModuleImpl 和客户端遥测不会把补丁质量问题归入网络噪声
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
package cn.reactnative.modules.update;

import java.io.IOException;

/**
 * A download task failure that happened after the artifact was fully
 * downloaded — unzip, hdiff apply, or bundled-resource copy (including the
 * copiesCrc content verification). UpdateModuleImpl rejects these with
 * PATCH_FAILED instead of DOWNLOAD_FAILED so the JS layer and server-side
 * telemetry can separate patch health from network health.
 */
class PatchFailedException extends IOException {
    PatchFailedException(String message, Throwable cause) {
        super(message, cause);
    }
}
