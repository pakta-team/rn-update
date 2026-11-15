/**
 * [INPUT]: 依赖 UpdateContext 持久配置/提交锁、NativeUpdateFlow 纯决策、OkHttp、DownloadTask 与 CrashRescue 截止时间；HTTP 尝试上限由 scripts/contract.json 的 endpointBudget 派生
 * [OUTPUT]: 对内提供每进程单轮 schedule、isRoundInFlight、runRescue，宿主侧有界阻塞入口 checkAndUpdate(UpdateContext, timeoutMs) 与 onConfigured；超时仅结束等待，轮次独立运行并保留配置/reset 复核
 * [POS]: Android 无 JS 冷启动更新 IO 编排器；不复制 rollout/响应决策，并以有界失败保障坏 bundle 自救，PaktaNativeUpdate 与 CrashRescue 经其收敛为同一轮
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
package cn.reactnative.modules.update;

import android.util.Log;
import androidx.annotation.Nullable;
import java.io.IOException;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import okhttp3.MediaType;
import okhttp3.Call;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okio.BufferedSource;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Native cold-start update check (NATIVE_CHECKUPDATE_DESIGN §10): once per
 * process, a few seconds after getBundleUrl, entirely independent of the app
 * bundle — this is what lets a device bricked by a bad hot update pull the
 * fixed version on the next launch. All decisions come from
 * cpp/update_flow_core via NativeUpdateFlow; this class is IO glue only.
 * Failures are silent and bounded: one round per launch, no retry storms, no
 * version blacklisting.
 */
final class NativeCheckOrchestrator {
    static final String KEY_CONFIG = "nativeConfig";
    // Raw response cache for the JS side to reuse (§10.3), scoped to the
    // exact logical request and native config that produced it.
    static final String KEY_RESP_CACHE = "nativeCheckResp";
    // Set when a round starts, cleared when it ends (§11.4). Residue on the
    // next launch means the previous process died mid-round (a crash rescue
    // was truncated): that launch resumes immediately instead of waiting 5s.
    static final String KEY_ROUND_INCOMPLETE = "nativeCheckIncomplete";
    private static final int MAX_CHECK_HTTP_ATTEMPTS = 8;
    // The check response (and a remote queryUrls list) is a small JSON
    // document; anything bigger is a broken or hijacked endpoint.
    private static final long MAX_CHECK_RESPONSE_BYTES = 1024 * 1024;

    private static final AtomicBoolean scheduled = new AtomicBoolean(false);
    // One round per process, whoever starts it first — the delayed cold-start
    // thread or the crash-rescue thread (§11.3). roundDone lets the rescue
    // wait for an in-flight round instead of racing it.
    private static final AtomicBoolean roundStarted = new AtomicBoolean(false);
    private static final CountDownLatch roundDone = new CountDownLatch(1);
    private static volatile boolean roundCompleted = false;
    // Flipped the moment a crash is being held. JS is dead from that point
    // on, so there is no second decision maker: the round force-activates
    // whatever it downloads (§11.3).
    private static volatile boolean crashRescueActive = false;
    // A version this process downloaded but left for JS to activate. If the
    // process then crashes, JS will never activate it — the crash handler
    // activates it directly (bounded local work, no network). The generation
    // is the one the round committed under: a reset that lands afterwards
    // bumps it, and the late activation must lose to that reset exactly like
    // the round itself would. Written generation-first, read hash-first, so
    // a torn read can only see a stricter (newer) generation.
    private static volatile String unactivatedHash;
    private static volatile long unactivatedGeneration;
    private static volatile long unactivatedConfigGeneration;
    private static volatile UpdateContext sContext;
    private static volatile String sLaunchRolledBackVersion;
    // Config JSON for which JS reported a completed check in this process
    // (markJsCheckCompleted). Process-scoped by design: the next launch
    // starts with no signal and the cold-start round runs again.
    private static volatile String sJsCompletedConfig;
    // Published after the launch rollback snapshot, before host calls are accepted.
    private static volatile boolean nativeReady;
    private static volatile NativeUpdateResult roundResult =
        NativeUpdateResult.of(NativeUpdateResult.FAILED, "check_failed");
    private static volatile long roundGeneration = -1;
    private static volatile long roundConfigGeneration = -1;
    private static volatile String roundConfigJson;

    static final long DEFAULT_HOST_TIMEOUT_MS = 30 * 60 * 1000L;

    static NativeUpdateResult checkAndUpdate(UpdateContext context) throws InterruptedException {
        return checkAndUpdate(context, DEFAULT_HOST_TIMEOUT_MS);
    }

    /** 只阻塞宿主等待池；超时不撤销其他调用方、冷启动或救援共用的轮次。 */
    static NativeUpdateResult checkAndUpdate(UpdateContext context, long timeoutMs) throws InterruptedException {
        if (UpdateContext.DEBUG) {
            return NativeUpdateResult.of(NativeUpdateResult.SKIPPED, "debug");
        }
        if (!nativeReady || sContext != context || !context.getIsUsingBundleUrl()) {
            return NativeUpdateResult.of(NativeUpdateResult.SKIPPED, "not_initialized");
        }
        String configJson = context.getKv(KEY_CONFIG);
        NativeUpdateResult rejection = configRejection(configJson);
        if (rejection != null) {
            return rejection;
        }
        if (claimRound()) {
            Thread thread = new Thread(new Runnable() {
                @Override public void run() { runClaimedRound(0); }
            }, "pakta-native-host-round");
            thread.setDaemon(true);
            try {
                thread.start();
            } catch (RuntimeException | Error error) {
                roundResult = NativeUpdateResult.of(NativeUpdateResult.FAILED, "internal_error");
                roundCompleted = true;
                roundDone.countDown();
                throw error;
            }
        }
        if (!roundStarted.get()) {
            return NativeUpdateResult.of(NativeUpdateResult.SKIPPED, "config_changed");
        }
        if (!roundDone.await(Math.max(0, timeoutMs), TimeUnit.MILLISECONDS)) {
            return NativeUpdateResult.of(NativeUpdateResult.FAILED, "timeout");
        }
        String cancelled = NativeUpdateFlow.hostCancellation(configJson, roundConfigJson,
            context.getKv(KEY_CONFIG), roundConfigGeneration, UpdateContext.getNativeConfigGeneration(),
            roundGeneration, UpdateContext.getResetGeneration());
        if (cancelled == null || !cancelled.isEmpty()) {
            return NativeUpdateResult.of(NativeUpdateResult.CANCELLED,
                cancelled == null ? "config_changed" : cancelled);
        }
        return roundResult;
    }


    static void markJsCheckCompleted(String config) {
        sJsCompletedConfig = config;
    }

    /**
     * True when JS already obtained a valid response in this process for the
     * exact config the native round would use: the delayed round is then a
     * duplicate request. Only the scheduled round consults this — the
     * crash-rescue path still runs, JS is dead by then.
     */
    private static boolean isJsCheckCompleted(UpdateContext context) {
        String jsConfig = sJsCompletedConfig;
        return jsConfig != null && NativeUpdateFlow.configsEquivalent(jsConfig, context.getKv(KEY_CONFIG));
    }

    private NativeCheckOrchestrator() {
    }

    static void schedule(final UpdateContext context, final String launchRolledBackVersion) {
        if (UpdateContext.DEBUG) {
            return;
        }
        if (!scheduled.compareAndSet(false, true)) {
            return;
        }
        sContext = context;
        sLaunchRolledBackVersion = launchRolledBackVersion;
        nativeReady = true;
        // The crash-hold rescue shares the orchestrator's rollout gate: no
        // persisted config, no handler (§11.3).
        if (context.getKv(KEY_CONFIG) != null) {
            CrashRescue.install();
        }
        Thread thread = new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    // Keep the check away from the cold-start critical path
                    // (§7 R5) — unless the previous process died mid-round,
                    // in which case every launch second counts (§11.4).
                    if (context.getKv(KEY_ROUND_INCOMPLETE) == null) {
                        Thread.sleep(5000);
                    }
                    if (isJsCheckCompleted(context)) {
                        // Not consuming the round: a later crash rescue may
                        // still need it.
                        Log.i(UpdateContext.TAG,
                            "native check skipped: JS check completed in this process");
                        return;
                    }
                    startRound(0);
                } catch (Throwable e) {
                    // The rescue path must never take the app down with it.
                    Log.w(UpdateContext.TAG, "native check failed: " + e);
                }
            }
        }, "pakta-native-check");
        thread.setPriority(Thread.MIN_PRIORITY + 1);
        thread.setDaemon(true);
        thread.start();
    }

    static boolean isRoundInFlight() {
        return roundStarted.get() && !roundCompleted;
    }

    static boolean isCrashRescueActive() {
        return crashRescueActive;
    }

    /**
     * Runs the process's single round on the calling thread if nobody has
     * started it yet. deadlineNanos > 0 (crash rescue) caps every HTTP call
     * and download phase to the remaining budget.
     */
    private static boolean hasRunnableConfig(UpdateContext context) {
        return context != null && configRejection(context.getKv(KEY_CONFIG)) == null;
    }

    static NativeUpdateResult configRejection(String json) {
        try {
            String result = NativeUpdateFlow.runnableConfig(json);
            if (result == null) {
                return NativeUpdateResult.of(NativeUpdateResult.FAILED, "internal_error");
            }
            JSONObject verdict = new JSONObject(result);
            return verdict.has("status")
                ? NativeUpdateResult.of(verdict.getString("status"), verdict.getString("reason")) : null;
        } catch (JSONException e) {
            return NativeUpdateResult.of(NativeUpdateResult.FAILED, "invalid_config");
        }
    }

    static void onConfigured(UpdateContext context) {
        if (nativeReady && sContext == context && hasRunnableConfig(context)) {
            CrashRescue.install();
        }
    }

    private static void startRound(long deadlineNanos) {
        if (claimRound()) {
            runClaimedRound(deadlineNanos);
        }
    }

    private static boolean claimRound() {
        return hasRunnableConfig(sContext) && roundStarted.compareAndSet(false, true);
    }

    private static void runClaimedRound(long deadlineNanos) {
        try {
            AndroidRound.Outcome outcome = AndroidRound.run(
                new DeviceRound(sContext, sLaunchRolledBackVersion), deadlineNanos);
            roundGeneration = outcome.resetGeneration;
            roundConfigGeneration = outcome.configGeneration;
            roundConfigJson = outcome.config;
            roundResult = outcome.result;
            if (NativeUpdateResult.DOWNLOADED.equals(roundResult.getStatus())) {
                unactivatedGeneration = outcome.resetGeneration;
                unactivatedConfigGeneration = outcome.configGeneration;
                unactivatedHash = roundResult.isActivated() ? null : roundResult.getHash();
            }
        } catch (Throwable e) {
            Log.w(UpdateContext.TAG, "native check failed: " + e);
            roundResult = NativeUpdateResult.of(NativeUpdateResult.FAILED, "internal_error");
        } finally {
            roundCompleted = true;
            roundDone.countDown();
        }
    }

    /**
     * Crash-rescue entry (§11.3), called from the handler's worker thread
     * while the uncaught-exception handler holds the dying process. Ensures
     * this process's round runs to completion within the budget, then
     * activates a downloaded-but-unactivated version if one exists — the
     * last chance before the process is gone.
     */
    static void runRescue(long deadlineNanos) {
        UpdateContext context = sContext;
        if (context == null) {
            return;
        }
        crashRescueActive = true;
        startRound(deadlineNanos);
        if (roundStarted.get() && !roundCompleted) {
            long remainingNanos = deadlineNanos - System.nanoTime();
            if (remainingNanos > 0) {
                try {
                    roundDone.await(remainingNanos, TimeUnit.NANOSECONDS);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return;
                }
            }
        }
        activatePendingVersion(context);
    }

    // The alert-strategy variant of the §10.7 hole: the round downloaded a
    // fix but deferred activation to JS, and JS is now dead. Activation is
    // local and bounded (the bundle digest, then a state switch under the
    // commit lock).
    private static void activatePendingVersion(UpdateContext context) {
        String hash = unactivatedHash;
        if (hash == null) {
            return;
        }
        String hashInfoJson = null;
        String existingInfo = context.getKv("hash_" + hash);
        if (existingInfo != null) {
            try {
                JSONObject info = new JSONObject(existingInfo);
                info.put("crashRescue", true);
                hashInfoJson = info.toString();
            } catch (JSONException ignored) {
            }
        }
        try {
            if (context.commitNativeRoundResult(
                    unactivatedGeneration, unactivatedConfigGeneration, hash, hashInfoJson, true, null)) {
                unactivatedHash = null;
                Log.i(UpdateContext.TAG,
                    "crash rescue: activated downloaded version " + hash);
            } else {
                Log.i(UpdateContext.TAG,
                    "crash rescue: reset since download, dropping activation");
            }
        } catch (Exception e) {
            Log.w(UpdateContext.TAG, "crash rescue: activation failed: " + e);
        }
    }

    private static final OkHttpClient httpClient = new OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .callTimeout(15, TimeUnit.SECONDS)
        .build();

    static String httpRequest(String url, String postBody, long timeoutMs, long callTimeoutMs,
        DeviceRound host) {
        try {
            Request.Builder builder =
                new Request.Builder().url(url).header("Accept", "application/json");
            if (postBody != null) {
                builder.post(RequestBody.create(
                    postBody, MediaType.parse("application/json; charset=utf-8")));
            }
            OkHttpClient client = httpClient.newBuilder()
                .connectTimeout(Math.max(1, timeoutMs), TimeUnit.MILLISECONDS)
                .readTimeout(Math.max(1, timeoutMs), TimeUnit.MILLISECONDS)
                .callTimeout(Math.max(1, callTimeoutMs), TimeUnit.MILLISECONDS)
                .build();
            Call call = client.newCall(builder.build());
            host.trackCall(call);
            try (Response response = call.execute()) {
                // Same rule as the artifact download: an https endpoint that
                // redirects to plaintext http is a failed endpoint.
                DownloadTask.rejectProtocolDowngrade(url, response);
                ResponseBody body = response.body();
                if (!response.isSuccessful() || body == null) {
                    return null;
                }
                return readBoundedBody(body);
            }
        } catch (Exception e) {
            // One line per failed endpoint; the fallback chain is otherwise
            // invisible in the field.
            Log.w(UpdateContext.TAG, "native check: request failed with "
                + e.getClass().getName() + ": " + e.getMessage());
            return null;
        } finally {
            host.trackCall(null);
        }
    }

    /**
     * Reads the body with a hard cap (CODE_AUDIT 2.7): a hijacked endpoint
     * must not be able to OOM this thread with an unbounded string. Over the
     * cap counts as a failed endpoint (null), like any other bad response.
     */
    @Nullable
    private static String readBoundedBody(ResponseBody body) throws IOException {
        if (body.contentLength() > MAX_CHECK_RESPONSE_BYTES) {
            return null;
        }
        BufferedSource source = body.source();
        if (source.request(MAX_CHECK_RESPONSE_BYTES + 1)) {
            Log.w(UpdateContext.TAG, "native check: response exceeds "
                + MAX_CHECK_RESPONSE_BYTES + " bytes, ignoring endpoint");
            return null;
        }
        MediaType contentType = body.contentType();
        Charset charset = contentType == null
            ? null : contentType.charset(StandardCharsets.UTF_8);
        return source.readString(charset == null ? StandardCharsets.UTF_8 : charset);
    }

}
