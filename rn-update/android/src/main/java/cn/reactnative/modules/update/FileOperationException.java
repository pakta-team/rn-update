/**
 * [INPUT]: 继承 java.io.IOException，携带本地文件系统规则语义
 * [OUTPUT]: 标记"被本地文件规则拒绝"的下载任务（如原地重装运行中版本），供 UpdateModuleImpl 以 FILE_OPERATION_FAILED 归类
 * [POS]: Android 下载链路的文件操作异常类型，与网络/补丁失败区分
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
package cn.reactnative.modules.update;

import java.io.IOException;

/**
 * A download task refused by a local file-system rule rather than by the
 * network or the patch itself — today: reinstalling the version this process
 * is running from in place (DownloadTask.ensureNotReinstallingRunningVersion).
 * UpdateModuleImpl rejects these with FILE_OPERATION_FAILED.
 */
class FileOperationException extends IOException {
    FileOperationException(String message) {
        super(message);
    }
}
