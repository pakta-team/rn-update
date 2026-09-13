/**
 * [INPUT]: 依赖单线程 Executor、Promise、UpdateContext 日志标识与稳定错误码
 * [OUTPUT]: 对内提供 Operation 和 run，按提交顺序在后台执行状态持久化并统一成功/失败回调
 * [POS]: Android 状态写入串行化边界，替代 UI 线程磁盘写入，同时保持 switch/mark/reset 的顺序语义
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
package cn.reactnative.modules.update;

import android.util.Log;
import androidx.annotation.Nullable;
import com.facebook.react.bridge.Promise;

import java.util.concurrent.Executor;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;

/**
 * Runs state-persistence operations (switchVersion / markSuccess / setUuid /
 * setLocalHashInfo) on a dedicated single background thread.
 *
 * These operations only read/modify SharedPreferences via a synchronous
 * commit(); they were previously dispatched to the UI thread purely to
 * serialize them. markSuccess in particular runs on every cold start, so doing
 * its blocking disk write on the main thread caused jank/ANR on low-end
 * devices. A single-thread executor preserves the same serialization guarantee
 * while keeping the disk I/O off the UI thread.
 *
 * Note: reload/restart operations must still run on the UI thread and therefore
 * keep using {@link UiThreadRunner}.
 */
final class StateSerialRunner {
    interface Operation {
        void run() throws Throwable;
    }

    // Single worker thread -> operations stay serialized in submission order,
    // matching the previous UI-thread behavior. The thread is named so it is
    // identifiable in thread dumps / ANR traces when diagnosing persistence.
    private static final Executor EXECUTOR = Executors.newSingleThreadExecutor(
        new ThreadFactory() {
            @Override
            public Thread newThread(Runnable r) {
                return new Thread(r, "pakta-state-serial");
            }
        });

    private StateSerialRunner() {
    }

    static void run(
        @Nullable final Promise promise,
        final String errorCode,
        final String operationName,
        final Operation operation
    ) {
        EXECUTOR.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    operation.run();
                } catch (Throwable error) {
                    if (promise != null) {
                        promise.reject(errorCode, operationName + " failed", error);
                    } else {
                        Log.e(UpdateContext.TAG, operationName + " failed", error);
                    }
                }
            }
        });
    }
}
