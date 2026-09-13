/**
 * [INPUT]: 依赖 UpdateContext 的持久状态快照与 cpp/patch_core 状态机 JNI 映射
 * [OUTPUT]: 对内提供包体身份、当前/上次版本、首启、回滚、清理、加载决策及成功确认匹配字段
 * [POS]: Android Java/C++ 状态机 DTO，是 SharedPreferences 表示与纯原生决策之间的数据载体
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
package cn.reactnative.modules.update;

class StateCoreResult {
    String packageVersion;
    String buildTime;
    String currentVersion;
    String lastVersion;
    boolean firstTime;
    boolean firstTimeOk;
    String rolledBackVersion;
    boolean changed;
    String staleVersionToDelete;
    String loadVersion;
    boolean didRollback;
    boolean consumedFirstTime;
    boolean markSuccessAccepted;
}
