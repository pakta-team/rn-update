/**
 * [INPUT]: 依赖 cpp/patch_core/error_codes.h 与 src/error.ts 的跨平台稳定码契约
 * [OUTPUT]: 对内提供 Android Promise 拒绝使用的机器可读错误码常量
 * [POS]: Android 错误协议单一事实映射，由 UpdateModuleImpl 和线程执行器消费，消息文本不属于稳定契约
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
package cn.reactnative.modules.update;

/**
 * Stable, machine-readable error codes used as the promise rejection code so
 * the JS layer and user loggers can aggregate errors across platforms.
 *
 * MUST stay in sync with cpp/patch_core/error_codes.h (the single source of
 * truth) and src/error.ts (UpdateErrorCode). Messages are free-form; only the
 * codes are part of the contract.
 */
final class ErrorCodes {
    static final String INVALID_OPTIONS = "INVALID_OPTIONS";
    static final String DOWNLOAD_FAILED = "DOWNLOAD_FAILED";
    static final String PATCH_FAILED = "PATCH_FAILED";
    static final String FILE_OPERATION_FAILED = "FILE_OPERATION_FAILED";
    static final String SWITCH_VERSION_FAILED = "SWITCH_VERSION_FAILED";
    static final String MARK_SUCCESS_FAILED = "MARK_SUCCESS_FAILED";
    static final String RESTART_FAILED = "RESTART_FAILED";
    static final String RESET_FAILED = "RESET_FAILED";
    static final String INVALID_HASH_INFO = "INVALID_HASH_INFO";
    static final String UNSUPPORTED_PLATFORM = "UNSUPPORTED_PLATFORM";
    static final String APK_INSTALL_PERMISSION_REQUIRED = "APK_INSTALL_PERMISSION_REQUIRED";
    static final String APK_INSTALL_FAILED = "APK_INSTALL_FAILED";

    private ErrorCodes() {
    }
}
