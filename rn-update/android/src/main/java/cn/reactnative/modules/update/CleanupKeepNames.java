/**
 * [INPUT]: 无依赖（自包含纯函数），为 cleanup JNI 的 keepnames 契约服务
 * [OUTPUT]: 提供 select，从 current/previous/running 中选出最多两个去重版本名（超限返回 null）
 * [POS]: Android 清理流程的 JNI keepnames 选择器，与 cpp 清理逻辑的版本名约束对齐
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
package cn.reactnative.modules.update;

/** Selects the at-most-two distinct version names supported by cleanup JNI. */
final class CleanupKeepNames {
    private CleanupKeepNames() {
    }

    static String[] select(String current, String previous, String running) {
        String[] keep = new String[2];
        for (String candidate : new String[] {current, previous, running}) {
            if (candidate == null || candidate.isEmpty()
                || candidate.equals(keep[0]) || candidate.equals(keep[1])) {
                continue;
            }
            if (keep[0] == null) {
                keep[0] = candidate;
            } else if (keep[1] == null) {
                keep[1] = candidate;
            } else {
                return null;
            }
        }
        return keep;
    }
}
