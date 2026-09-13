/**
 * [INPUT]: 依赖 React Native UiThreadUtil、Promise 与 UpdateContext 统一日志标识
 * [OUTPUT]: 对内提供 Operation 和 run，在主线程执行 React 重载类副作用并映射稳定错误码
 * [POS]: Android UI 生命周期执行边界，与只处理持久化的 StateSerialRunner 分工
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
package cn.reactnative.modules.update;

import android.util.Log;
import androidx.annotation.Nullable;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.UiThreadUtil;

final class UiThreadRunner {
    interface Operation {
        void run() throws Throwable;
    }

    private UiThreadRunner() {
    }

    static void run(
        @Nullable final Promise promise,
        final String errorCode,
        final String operationName,
        final Operation operation
    ) {
        UiThreadUtil.runOnUiThread(new Runnable() {
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
