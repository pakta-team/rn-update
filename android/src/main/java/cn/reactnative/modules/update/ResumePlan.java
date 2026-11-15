/**
 * [INPUT]: 依赖 NativeUpdateCore 的库加载门与共享 resume_plan 的三个静态 JNI 入口
 * [OUTPUT]: 向包内 DownloadTask 提供请求规划、响应分类及 sidecar JSON，不暴露公共 RN 桥
 * [POS]: Android 下载器与共享续传规则的薄适配层，不拥有网络、文件 IO 或更新轮次
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
package cn.reactnative.modules.update;

final class ResumePlan {
    static {
        NativeUpdateCore.ensureLoaded();
    }

    private ResumePlan() {}

    static native String planRequest(String sidecar, String url, long partialSize);
    static native String classifyResponse(int status, long offset, String range,
        String encoding, long length, String sidecar, String url, long partialSize);
    static native String sidecar(String url, String etag, String modified,
        String previous, long total);
}
