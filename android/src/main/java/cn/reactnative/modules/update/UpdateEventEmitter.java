/**
 * [INPUT]: 依赖 ReactApplicationContext、DeviceEventManagerModule、WritableMap 与新旧 RN 实例存活探测
 * [OUTPUT]: 对内提供 register 和 sendEvent，将下载进度安全发送到 RCTPaktaDownloadProgress 通道
 * [POS]: Android 原生到 JS 的事件桥，以弱引用和销毁竞态保护避免更新触发重载时崩溃
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
package cn.reactnative.modules.update;

import android.util.Log;
import androidx.annotation.Nullable;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import com.facebook.react.bridge.WritableMap;
import java.lang.ref.WeakReference;
import java.lang.reflect.Method;

final class UpdateEventEmitter {
    private static WeakReference<ReactApplicationContext> reactContextRef =
        new WeakReference<ReactApplicationContext>(null);

    private UpdateEventEmitter() {
    }

    static synchronized void register(ReactApplicationContext reactContext) {
        reactContextRef = new WeakReference<ReactApplicationContext>(reactContext);
    }

    @Nullable
    private static synchronized ReactApplicationContext getReactContext() {
        return reactContextRef.get();
    }

    static void sendEvent(String eventName, WritableMap params) {
        ReactApplicationContext reactContext = getReactContext();
        if (reactContext == null || !hasActiveInstance(reactContext)) {
            return;
        }

        try {
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                .emit(eventName, params);
        } catch (RuntimeException e) {
            // The instance can be torn down between the check above and the
            // emit (this SDK itself triggers reloads); sendEvent runs on the
            // main thread, so a throw here would crash the app for a lost
            // progress tick.
            Log.w("pakta", "sendEvent " + eventName + " failed: " + e.getMessage());
        }
    }

    @SuppressWarnings("deprecation")
    private static boolean hasActiveInstance(ReactApplicationContext reactContext) {
        try {
            // Use reflection for hasActiveReactInstance() because older RN versions (<0.68)
            // don't have this method in the class signature at compile time.
            Method method = reactContext.getClass().getMethod("hasActiveReactInstance");
            Object result = method.invoke(reactContext);
            if (result instanceof Boolean) {
                return (Boolean) result;
            }
        } catch (Throwable ignored) {
            // RN < 0.68 has no hasActiveReactInstance(); fall back for old peers.
        }
        try {
            return reactContext.hasActiveCatalystInstance();
        } catch (Throwable ignored) {
            return false;
        }
    }
}
