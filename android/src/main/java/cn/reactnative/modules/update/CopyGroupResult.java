/**
 * [INPUT]: 依赖 cpp/patch_core 对补丁 copies 清单的分组结果
 * [OUTPUT]: 对内提供 from 与 toPaths 的 JNI 复制分组载体
 * [POS]: Android Java/C++ 边界的复制 DTO，由 DownloadTask 转换为真实目标文件
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
package cn.reactnative.modules.update;

class CopyGroupResult {
    String from;
    String[] toPaths;
}
