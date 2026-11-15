package cn.reactnative.modules.update;

/**
 * [INPUT]: 依赖 NativeUpdateConfig 归一化、NativeCheckOrchestrator.checkAndUpdate 编排、UpdateContext.setNativeConfig、BuildConfig.DEBUG 门与 Handler/Looper 主线程回调
 * [OUTPUT]: 对外提供静态 configure 与 checkAndUpdate 无桥宿主 API；checkAndUpdate 可指定仅约束调用方等待的 timeoutMillis，旧签名默认 30 分钟
 * [POS]: Android 宿主直连的桥外门面；配置单线程与宿主并发等待池隔离，各调用独立计时，回调一律回主线程，超时不取消共享检查轮
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import androidx.annotation.Nullable;
import org.json.JSONObject;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;

/** Bridge-free native configuration and update APIs. */
public final class PaktaNativeUpdate {
    public interface Callback {
        /** Always called on the main thread, including skipped and failed checks. */
        void onComplete(NativeUpdateResult result);
    }

    // 等待线程可复用且互不排队，短期限调用不能被较早的长等待阻塞。
    private static final Executor WORKER = Executors.newCachedThreadPool(new ThreadFactory() {
        @Override
        public Thread newThread(Runnable runnable) {
            Thread thread = new Thread(runnable, "pakta-host-check");
            thread.setDaemon(true);
            return thread;
        }
    });

    public interface ConfigurationCallback {
        /** Main thread; null means configuration was persisted successfully. */
        void onComplete(@Nullable Exception error);
    }

    // Configuration must not wait behind a network round that it invalidates.
    private static final Executor CONFIG_WORKER = Executors.newSingleThreadExecutor(new ThreadFactory() {
        @Override
        public Thread newThread(Runnable runnable) {
            Thread thread = new Thread(runnable, "pakta-host-config");
            thread.setDaemon(true);
            return thread;
        }
    });

    /**
     * Validate and persist a complete configuration, even before JS or bundle
     * resolution. This starts no network work and never resolves a bundle.
     * Await the callback before continuing startup/checkAndUpdate. Unless JS
     * uses nativeConfigSource: 'native', later JS config writes can replace it.
     */
    public static void configure(Context context, JSONObject options, final ConfigurationCallback callback) {
        if (context == null || options == null || callback == null) {
            throw new IllegalArgumentException("context, options and callback are required");
        }
        final Context applicationContext = context.getApplicationContext();
        // Snapshot caller-owned JSON before dispatch, not minutes later on a worker.
        final String snapshot = options.toString();
        CONFIG_WORKER.execute(new Runnable() {
            @Override
            public void run() {
                Exception failure = null;
                try {
                    String config = NativeUpdateConfig.normalize(snapshot);
                    UpdateContext.getInstance(applicationContext).setNativeConfig(config);
                } catch (Exception e) {
                    failure = e;
                } catch (LinkageError e) {
                    failure = new IllegalStateException("Native configuration failed", e);
                }
                final Exception error = failure;
                new Handler(Looper.getMainLooper()).post(new Runnable() {
                    @Override
                    public void run() {
                        callback.onComplete(error);
                    }
                });
            }
        });
    }

    private PaktaNativeUpdate() {
    }

    /**
     * Start the process's native check now, join its in-flight round, or return
     * its completed result. This does not reload React Native or show UI.
     *
     * Call after the host has resolved its real launch bundle with
     * UpdateContext.getBundleUrl. Do not resolve the bundle again just to call
     * this method: bundle resolution consumes first-load/rollback markers.
     * Missing persisted configuration and debug builds are reported as skipped.
     */
    public static void checkAndUpdate(Context context, final Callback callback) {
        checkAndUpdate(context, NativeCheckOrchestrator.DEFAULT_HOST_TIMEOUT_MS, callback);
    }

    /**
     * 期限只限制本调用等待；failed/timeout 不表示共享轮次失败或取消。
     * 轮次继续为下次启动准备版本，提交仍须通过配置/reset 代际门卫。
     */
    public static void checkAndUpdate(Context context, final long timeoutMillis, final Callback callback) {
        if (context == null || callback == null) {
            throw new IllegalArgumentException("context and callback are required");
        }
        final Context applicationContext = context.getApplicationContext();
        WORKER.execute(new Runnable() {
            @Override
            public void run() {
                NativeUpdateResult outcome;
                try {
                    if (BuildConfig.DEBUG) {
                        outcome = NativeUpdateResult.of(NativeUpdateResult.SKIPPED, "debug");
                    } else {
                        outcome = NativeCheckOrchestrator.checkAndUpdate(
                            UpdateContext.getInstance(applicationContext), timeoutMillis);
                    }
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    outcome = NativeUpdateResult.of(NativeUpdateResult.CANCELLED, "interrupted");
                } catch (Exception | LinkageError e) {
                    Log.w("react-native-update", "native host check failed", e);
                    outcome = NativeUpdateResult.of(NativeUpdateResult.FAILED, "internal_error");
                }
                final NativeUpdateResult result = outcome;
                new Handler(Looper.getMainLooper()).post(new Runnable() {
                    @Override
                    public void run() {
                        callback.onComplete(result);
                    }
                });
            }
        });
    }
}
