/**
 * [INPUT]: 依赖 UpdateContext 原子配置/双代际快照与状态/下载/提交、NativeCheckOrchestrator HTTP 与 NativeUpdateFlow JNI
 * [OUTPUT]: 实现 AndroidRound.RoundHost，将设备环境、时钟、可取消 OkHttp Call 和既有下载链提供给执行器
 * [POS]: AndroidRound 的生产 IO 适配；channel 来自安装包身份，策略仍由共享核决定
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
package cn.reactnative.modules.update;

import android.os.Build;
import okhttp3.Call;
import org.json.JSONException;
import org.json.JSONObject;

final class DeviceRound implements AndroidRound.RoundHost {
    private final UpdateContext context;
    private final String rolledBackVersion;
    private volatile Call activeCall;
    private volatile boolean httpCancelled;

    DeviceRound(UpdateContext context, String rolledBackVersion) {
        this.context = context;
        this.rolledBackVersion = rolledBackVersion;
    }

    @Override
    public String stepRound(String state, String event) {
        return NativeUpdateFlow.stepRound(state, event);
    }

    @Override
    public long nanoTime() {
        return System.nanoTime();
    }

    @Override
    public boolean crashHold() {
        return NativeCheckOrchestrator.isCrashRescueActive();
    }

    @Override
    public long resetGeneration() {
        return UpdateContext.getResetGeneration();
    }

    @Override
    public long configGeneration() {
        return UpdateContext.getNativeConfigGeneration();
    }

    @Override
    public AndroidRound.StartSnapshot snapshot() {
        return context.snapshotNativeRound();
    }

    @Override
    public void setKv(String key, String value) {
        context.setKv(key, value);
    }

    @Override
    public void removeKv(String key) {
        context.removeKv(key);
    }

    @Override
    public JSONObject launchEnv() throws JSONException {
        String current = context.getCurrentVersion();
        return new JSONObject().put("packageVersion", context.getPackageVersion())
            .put("currentVersion", current == null ? JSONObject.NULL : current)
            .put("channel", context.getChannel()).put("uuid", context.getKv("uuid"))
            .put("rolledBackVersion", rolledBackVersion).put("buildTime", context.getBuildTime())
            .put("os", "android " + Build.VERSION.SDK_INT).put("bundleHash", context.computeBundleHash());
    }

    @Override
    public String httpRequest(String url, String body, long timeoutMs, long callTimeoutMs) {
        return NativeCheckOrchestrator.httpRequest(url, body, timeoutMs, callTimeoutMs, this);
    }

    void trackCall(Call call) {
        activeCall = call;
        if (call != null && httpCancelled) {
            call.cancel();
        }
    }

    @Override
    public void cancelHttp() {
        httpCancelled = true;
        Call call = activeCall;
        if (call != null) {
            call.cancel();
        }
    }

    @Override
    public double wallSeconds() {
        return System.currentTimeMillis() / 1000.0;
    }

    @Override
    public boolean hasCompletedVersion(String hash) {
        return context.hasCompletedVersion(hash);
    }

    @Override
    public boolean commit(long reset, long generation, String hash, String info,
        boolean activate, String cache) {
        return context.commitNativeRoundResult(reset, generation, hash, info, activate, cache);
    }

    @Override
    public DownloadTaskParams start(String strategy, String url, String hash, String originHash,
        UpdateContext.DownloadFileListener listener, long deadlineNanos) {
        if ("diff".equals(strategy)) {
            return context.downloadPatchFromPpk(url, hash, originHash, listener, deadlineNanos);
        }
        if ("pdiff".equals(strategy)) {
            return context.downloadPatchFromApk(url, hash, listener, deadlineNanos);
        }
        return context.downloadFullUpdate(url, hash, listener, deadlineNanos);
    }
}
