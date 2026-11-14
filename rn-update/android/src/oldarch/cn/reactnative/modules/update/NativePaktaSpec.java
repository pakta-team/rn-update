/**
 * [INPUT]: 依赖 src/NativePakta.ts，由 scripts/generate-native-bindings.js 生成，禁止手改
 * [OUTPUT]: 提供旧架构 NativePaktaSpec 抽象桥声明；保留 expectedHash 与 Integer count
 * [POS]: oldarch 的生成契约层，UpdateModule 负责委托共享实现，常量仍由实现提供
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
package cn.reactnative.modules.update;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableMap;

public abstract class NativePaktaSpec extends ReactContextBaseJavaModule {
    protected NativePaktaSpec(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @ReactMethod
    public abstract void setLocalHashInfo(String hash, String info, Promise promise);

    @ReactMethod
    public abstract void getLocalHashInfo(String hash, Promise promise);

    @ReactMethod
    public abstract void setUuid(String uuid, Promise promise);

    @ReactMethod
    public abstract void syncNativeConfig(String config, Promise promise);

    @ReactMethod
    public abstract void getNativeCheckCache(Promise promise);

    @ReactMethod
    public abstract void markJsCheckCompleted(String config, Promise promise);

    @ReactMethod
    public abstract void reloadUpdate(ReadableMap options, Promise promise);

    @ReactMethod
    public abstract void restartApp(Promise promise);

    @ReactMethod
    public abstract void setNeedUpdate(ReadableMap options, Promise promise);

    @ReactMethod
    public abstract void markSuccess(String expectedHash, Promise promise);

    @ReactMethod
    public abstract void getBundleHash(Promise promise);

    @ReactMethod
    public abstract void resetToPackagedBundle(Promise promise);

    @ReactMethod
    public abstract void downloadPatchFromPpk(ReadableMap options, Promise promise);

    @ReactMethod
    public abstract void downloadPatchFromPackage(ReadableMap options, Promise promise);

    @ReactMethod
    public abstract void downloadFullUpdate(ReadableMap options, Promise promise);

    @ReactMethod
    public abstract void downloadAndInstallApk(ReadableMap options, Promise promise);

    @ReactMethod
    public abstract void addListener(String eventName);

    @ReactMethod
    public abstract void removeListeners(Integer count);
}
