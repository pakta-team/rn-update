/**
 * [INPUT]: 依赖 System.loadLibrary 加载的 librnupdate 与 getSupportedDiffVersion JNI 符号
 * [OUTPUT]: 对内提供幂等 ensureLoaded 和原生 supportedDiffVersion 能力查询
 * [POS]: Android 共享原生库加载门，被状态、下载和冷启动决策桥共同复用
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
package cn.reactnative.modules.update;

final class NativeUpdateCore {
    private static boolean loaded = false;

    private NativeUpdateCore() {
    }

    static synchronized void ensureLoaded() {
        if (loaded) {
            return;
        }

        try {
            System.loadLibrary("rnupdate");
        } catch (UnsatisfiedLinkError error) {
            UnsatisfiedLinkError wrapped = new UnsatisfiedLinkError(
                "Failed to load rnupdate native library. Original error: "
                    + error.getMessage());
            wrapped.initCause(error);
            throw wrapped;
        }

        loaded = true;
    }

    /**
     * 原生 patch 内核可消费的 diff 轨道版本(2 = hdiffv2 轨道)。
     * 经 getConstants 暴露给 JS,再随 checkUpdate 以 diffV 上报,
     * 服务端按能力门控下发。
     */
    static int supportedDiffVersion() {
        ensureLoaded();
        return getSupportedDiffVersion();
    }

    private static native int getSupportedDiffVersion();
}
