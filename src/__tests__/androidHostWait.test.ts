/**
 * [INPUT]: 依赖 JDK 17+、bun:test 与完整 Android 宿主门面/编排器/结果源码，Android API、配置核和轮次 IO 使用宿主替身
 * [OUTPUT]: 提供真实 Java 线程下的独立等待期限、单飞、超时后完成、双代际拒绝与中断回归
 * [POS]: Android 无桥宿主等待契约；编译真实生产类而非复制等待逻辑，不代表 JNI/ART、系统主线程或真实下载提交
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = mkdtempSync(join(tmpdir(), 'pakta-host-wait-'));
const packagePath = 'cn/reactnative/modules/update';
const javaRoot = fileURLToPath(
  new URL('../../android/src/main/java/', import.meta.url)
);

const stubs: Record<string, string> = {
  'android/content/Context.java':
    'package android.content; public class Context { public Context getApplicationContext() { return this; } }',
  'android/os/Looper.java':
    'package android.os; public class Looper { public static Looper getMainLooper() { return new Looper(); } }',
  'android/os/Handler.java':
    'package android.os; public class Handler { public Handler(Looper l) {} public boolean post(Runnable r) { r.run(); return true; } }',
  'android/util/Log.java':
    'package android.util; public class Log { public static int i(String t, String m) { return 0; } public static int w(String t, String m) { return 0; } public static int w(String t, String m, Throwable e) { return 0; } }',
  'androidx/annotation/Nullable.java':
    'package androidx.annotation; public @interface Nullable {}',
  'org/json/JSONException.java':
    'package org.json; public class JSONException extends Exception {}',
  'org/json/JSONObject.java':
    'package org.json; public class JSONObject { final String text; public JSONObject(String t) throws JSONException { text = t; } public boolean has(String k) { return false; } public String getString(String k) throws JSONException { throw new JSONException(); } public JSONObject put(String k, Object v) throws JSONException { return this; } public String toString() { return text; } }',
  'okio/BufferedSource.java':
    'package okio; public interface BufferedSource { boolean request(long n) throws java.io.IOException; String readString(java.nio.charset.Charset c) throws java.io.IOException; }',
  'okhttp3/MediaType.java':
    'package okhttp3; public class MediaType { public static MediaType parse(String t) { return new MediaType(); } public java.nio.charset.Charset charset(java.nio.charset.Charset c) { return c; } }',
  'okhttp3/RequestBody.java':
    'package okhttp3; public class RequestBody { public static RequestBody create(String t, MediaType m) { return new RequestBody(); } }',
  'okhttp3/Request.java':
    'package okhttp3; public class Request { public static class Builder { public Builder url(String t) { return this; } public Builder header(String n, String v) { return this; } public Builder post(RequestBody b) { return this; } public Request build() { return new Request(); } } }',
  'okhttp3/ResponseBody.java':
    'package okhttp3; public class ResponseBody { public long contentLength() { return 0; } public okio.BufferedSource source() { throw new AssertionError("unexpected HTTP"); } public MediaType contentType() { return null; } }',
  'okhttp3/Response.java':
    'package okhttp3; public class Response implements AutoCloseable { public boolean isSuccessful() { return false; } public ResponseBody body() { return null; } public void close() {} }',
  'okhttp3/Call.java':
    'package okhttp3; public interface Call { Response execute() throws java.io.IOException; }',
  'okhttp3/OkHttpClient.java': `package okhttp3; public class OkHttpClient {
    public Builder newBuilder() { return new Builder(); }
    public Call newCall(Request r) { throw new AssertionError("unexpected HTTP"); }
    public static class Builder {
      public Builder connectTimeout(long t, java.util.concurrent.TimeUnit u) { return this; }
      public Builder readTimeout(long t, java.util.concurrent.TimeUnit u) { return this; }
      public Builder callTimeout(long t, java.util.concurrent.TimeUnit u) { return this; }
      public OkHttpClient build() { return new OkHttpClient(); }
    }
  }`,
  [`${packagePath}/BuildConfig.java`]:
    'package cn.reactnative.modules.update; final class BuildConfig { static final boolean DEBUG = false; }',
  [`${packagePath}/NativeUpdateConfig.java`]:
    'package cn.reactnative.modules.update; final class NativeUpdateConfig { static String normalize(String value) { return value; } }',
  [`${packagePath}/CrashRescue.java`]:
    'package cn.reactnative.modules.update; final class CrashRescue { static void install() {} }',
  [`${packagePath}/DownloadTask.java`]:
    'package cn.reactnative.modules.update; final class DownloadTask { static void rejectProtocolDowngrade(String url, okhttp3.Response r) {} }',
  [`${packagePath}/DeviceRound.java`]: `package cn.reactnative.modules.update; final class DeviceRound {
    final UpdateContext context;
    DeviceRound(UpdateContext c, String rollback) { context = c; }
    void trackCall(okhttp3.Call call) {}
  }`,
  [`${packagePath}/UpdateContext.java`]: `package cn.reactnative.modules.update; final class UpdateContext {
    static final boolean DEBUG = false;
    static final String TAG = "pakta";
    static final UpdateContext INSTANCE = new UpdateContext();
    static volatile long reset, generation;
    volatile String config = "configuration";
    static UpdateContext getInstance(android.content.Context c) { return INSTANCE; }
    String getKv(String key) { return key.equals("nativeConfig") ? config : null; }
    void setNativeConfig(String value) { config = value; generation++; }
    boolean getIsUsingBundleUrl() { return true; }
    static long getNativeConfigGeneration() { return generation; }
    static long getResetGeneration() { return reset; }
    boolean commitNativeRoundResult(long a, long b, String h, String i, boolean activate, String cache) { throw new AssertionError("unexpected rescue"); }
  }`,
  [`${packagePath}/NativeUpdateFlow.java`]: `package cn.reactnative.modules.update; final class NativeUpdateFlow {
    static String runnableConfig(String c) { return "{}"; }
    static boolean configsEquivalent(String a, String b) { return java.util.Objects.equals(a, b); }
    static String hostCancellation(String host, String round, String stored, long initialConfig, long currentConfig, long initialReset, long currentReset) {
      if (initialConfig != currentConfig || !configsEquivalent(host, round) || !configsEquivalent(host, stored)) return "config_changed";
      return initialReset == currentReset ? "" : "reset";
    }
  }`,
  [`${packagePath}/AndroidRound.java`]: `package cn.reactnative.modules.update;
  import java.util.concurrent.*; import java.util.concurrent.atomic.*;
  final class AndroidRound {
    static final CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
    static final AtomicInteger calls = new AtomicInteger(), commits = new AtomicInteger();
    static volatile Thread worker;
    static final class Outcome {
      final long resetGeneration, configGeneration; final String config; final NativeUpdateResult result;
      Outcome(long r, long c, String text, NativeUpdateResult value) { resetGeneration = r; configGeneration = c; config = text; result = value; }
    }
    static Outcome run(DeviceRound host, long deadline) throws InterruptedException {
      calls.incrementAndGet(); worker = Thread.currentThread();
      long reset = UpdateContext.reset, generation = UpdateContext.generation;
      String config = host.context.config;
      entered.countDown();
      if (!release.await(4, TimeUnit.SECONDS)) throw new AssertionError("unreleased test round");
      String rejection = NativeUpdateFlow.hostCancellation(config, config, host.context.config, generation, UpdateContext.generation, reset, UpdateContext.reset);
      if (!rejection.isEmpty()) return new Outcome(reset, generation, config, NativeUpdateResult.of(NativeUpdateResult.CANCELLED, rejection));
      commits.incrementAndGet();
      return new Outcome(reset, generation, config, NativeUpdateResult.downloaded("v2", true));
    }
  }`,
  [`${packagePath}/HostWaitHarness.java`]: `package cn.reactnative.modules.update;
  import java.lang.reflect.*; import java.util.concurrent.*; import java.util.concurrent.atomic.*;
  public final class HostWaitHarness {
    static void require(boolean value, String reason) { if (!value) throw new AssertionError(reason); }
    static void set(String name, Object value) throws Exception {
      Field field = NativeCheckOrchestrator.class.getDeclaredField(name); field.setAccessible(true); field.set(null, value);
    }
    static void timeout(NativeUpdateResult value) { require(value.getStatus().equals("failed") && value.getReason().equals("timeout"), "expected failed/timeout"); }
    public static void main(String[] args) throws Exception {
      UpdateContext context = UpdateContext.INSTANCE;
      set("sContext", context); set("nativeReady", true);
      try {
        String scenario = args[0];
        if (scenario.equals("concurrent") || scenario.equals("default")) {
          CompletableFuture<NativeUpdateResult> first = new CompletableFuture<>();
          AtomicInteger callbacks = new AtomicInteger();
          PaktaNativeUpdate.Callback complete = result -> { callbacks.incrementAndGet(); first.complete(result); };
          android.content.Context application = new android.content.Context();
          if (scenario.equals("default")) PaktaNativeUpdate.checkAndUpdate(application, complete);
          else PaktaNativeUpdate.checkAndUpdate(application, 3000, complete);
          require(AndroidRound.entered.await(1, TimeUnit.SECONDS), "round did not start");
          require(AndroidRound.worker.isDaemon(), "round must be a daemon");
          require(!AndroidRound.worker.getName().equals("pakta-host-check"), "round ran on waiting worker");
          CompletableFuture<NativeUpdateResult> second = new CompletableFuture<>();
          PaktaNativeUpdate.checkAndUpdate(application, 20, second::complete);
          timeout(second.get(1, TimeUnit.SECONDS));
          require(!first.isDone(), "short timeout cancelled the other waiter");
          AndroidRound.release.countDown();
          require(first.get(1, TimeUnit.SECONDS).getHash().equals("v2"), "long waiter lost result");
          require(callbacks.get() == 1, "callback repeated");
          require(NativeCheckOrchestrator.DEFAULT_HOST_TIMEOUT_MS == 1800000, "legacy default changed");
        } else if (scenario.equals("interrupted")) {
          AtomicBoolean interrupted = new AtomicBoolean();
          Thread waiter = new Thread(() -> {
            try { NativeCheckOrchestrator.checkAndUpdate(context, 3000); }
            catch (InterruptedException expected) { interrupted.set(true); }
          });
          waiter.start();
          require(AndroidRound.entered.await(1, TimeUnit.SECONDS), "round did not start");
          waiter.interrupt(); waiter.join(1000);
          require(interrupted.get(), "interruption was swallowed");
          AndroidRound.release.countDown();
          require(NativeCheckOrchestrator.checkAndUpdate(context, 1000).getHash().equals("v2"), "interruption cancelled shared round");
        } else {
          long started = System.nanoTime();
          timeout(NativeCheckOrchestrator.checkAndUpdate(context, scenario.equals("negative") ? -1 : 20));
          require(System.nanoTime() - started < TimeUnit.SECONDS.toNanos(1), "host wait did not expire");
          require(AndroidRound.entered.await(1, TimeUnit.SECONDS), "round did not start");
          require(AndroidRound.commits.get() == 0, "round committed before release");
          if (scenario.equals("reset")) UpdateContext.reset++;
          if (scenario.equals("config")) { UpdateContext.generation++; context.config = "replacement"; }
          AndroidRound.release.countDown();
          NativeUpdateResult result = NativeCheckOrchestrator.checkAndUpdate(context, 1000);
          if (scenario.equals("reset") || scenario.equals("config")) {
            require(result.getStatus().equals("cancelled"), "late result was accepted");
            require(result.getReason().equals(scenario.equals("reset") ? "reset" : "config_changed"), "wrong cancellation reason");
            require(AndroidRound.commits.get() == 0, "stale round committed");
          } else {
            require(result.getHash().equals("v2") && result.isActivated(), "timeout discarded eventual result");
            require(AndroidRound.commits.get() == 1, "round committed more than once");
            require(NativeCheckOrchestrator.checkAndUpdate(context, 0).getHash().equals("v2"), "completed result should not expire");
          }
        }
        require(AndroidRound.calls.get() == 1, "host calls restarted the round");
        System.out.println("PASS " + scenario);
      } finally { AndroidRound.release.countDown(); }
    }
  }`,
};

beforeAll(() => {
  const sources: string[] = [];
  for (const [relative, source] of Object.entries(stubs)) {
    const file = join(directory, relative);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source);
    sources.push(file);
  }
  for (const name of [
    'PaktaNativeUpdate',
    'NativeCheckOrchestrator',
    'NativeUpdateResult',
  ]) {
    const file = join(directory, packagePath, `${name}.java`);
    copyFileSync(join(javaRoot, packagePath, `${name}.java`), file);
    sources.push(file);
  }
  const compile = spawnSync(
    'javac',
    ['-encoding', 'UTF-8', '-d', directory, ...sources],
    { encoding: 'utf8', timeout: 20000 }
  );
  if (compile.status !== 0)
    throw new Error(
      `Android host harness compile failed: ${compile.stderr || compile.error}`
    );
}, 30000);

afterAll(() => {
  if (
    resolve(dirname(directory)) !== resolve(tmpdir()) ||
    !basename(directory).startsWith('pakta-host-wait-')
  ) {
    throw new Error('refusing to clean an unexpected host harness path');
  }
  if (readdirSync(directory).length)
    rmSync(directory, { recursive: true, force: true });
});

for (const scenario of [
  'concurrent',
  'default',
  'eventual',
  'negative',
  'reset',
  'config',
  'interrupted',
]) {
  test(`Android host wait: ${scenario}`, () => {
    const run = spawnSync(
      'java',
      [
        '-cp',
        directory,
        `${packagePath.replaceAll('/', '.')}.HostWaitHarness`,
        scenario,
      ],
      { encoding: 'utf8', timeout: 8000 }
    );
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toBe(`PASS ${scenario}`);
  });
}
