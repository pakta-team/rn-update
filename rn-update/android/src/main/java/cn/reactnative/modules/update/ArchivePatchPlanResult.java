/**
 * [INPUT]: 依赖 DownloadTask 的归档补丁请求与 cpp/patch_core Android JNI 返回字段
 * [OUTPUT]: 对内提供 mergeSourceSubdir、enableMerge 的 JNI 结果载体
 * [POS]: Android Java/C++ 边界的归档规划 DTO，只承载数据，不执行文件操作
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
package cn.reactnative.modules.update;

class ArchivePatchPlanResult {
    String mergeSourceSubdir;
    boolean enableMerge;
}
