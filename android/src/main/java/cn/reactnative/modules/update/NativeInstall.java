/**
 * [INPUT]: 依赖 NativeUpdateCore 加载 librnupdate 及 native_install_jni 的安装/归档绑定
 * [OUTPUT]: 提供包内 execute、激活快照检查/复核/释放与归档条目 inspect 的静态 JNI 接口
 * [POS]: Java 安装调用链到共享核的内部门面，不扩大公共 RN Spec；快照生命周期由 InstallRecord 管理
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
package cn.reactnative.modules.update;

import java.io.IOException;

final class NativeInstall {
    static {
        NativeUpdateCore.ensureLoaded();
    }

    private NativeInstall() {
    }

    static native String execute(String operation, String first, String second,
        String third, String fourth) throws IOException;

    static native long checkActivation(String directory, String hash, String bundle,
        boolean grandfathered) throws IOException;

    static native boolean unchanged(long snapshot, boolean grandfathered) throws IOException;

    static native void release(long snapshot);

    static native long inspect(String[] names, long[] sizes, long[] compressed,
        long archiveBytes) throws IOException;
}
