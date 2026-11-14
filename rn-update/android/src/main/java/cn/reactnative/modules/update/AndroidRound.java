/**
 * [INPUT]: 依赖 RoundHost 注入共享 StepRound、IO、时钟、配置/双代际原子快照及 UpdateContext 下载回调
 * [OUTPUT]: 提供包内 run/StartSnapshot/Outcome 与 RoundHost 端口，执行命令、回传事件并清理中断标记
 * [POS]: Android 共享轮次执行器；观察取消和下载截止时间，不另写端点策略，锁内提交由宿主负责
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
package cn.reactnative.modules.update;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

final class AndroidRound {
    private static final long CLOCK_ORIGIN = System.nanoTime() - TimeUnit.SECONDS.toNanos(1);

    interface RoundHost {
        String stepRound(String state, String event);
        long nanoTime();
        boolean crashHold();
        StartSnapshot snapshot();
        long resetGeneration();
        long configGeneration();
        void setKv(String key, String value);
        void removeKv(String key);
        JSONObject launchEnv() throws JSONException;
        String httpRequest(String url, String body, long timeoutMs, long callTimeoutMs);
        double wallSeconds();
        boolean hasCompletedVersion(String hash);
        void cancelHttp();
        boolean commit(long resetGeneration, long configGeneration, String hash,
            String hashInfo, boolean activate, String cache) throws Exception;
        DownloadTaskParams start(String strategy, String url, String hash, String originHash,
            UpdateContext.DownloadFileListener listener, long deadlineNanos);
    }

    static final class StartSnapshot {
        final long resetGeneration;
        final long configGeneration;
        final String config;

        StartSnapshot(long resetGeneration, long configGeneration, String config) {
            this.resetGeneration = resetGeneration;
            this.configGeneration = configGeneration;
            this.config = config;
        }
    }

    static final class Outcome {
        final long resetGeneration;
        final long configGeneration;
        final String config;
        final NativeUpdateResult result;

        Outcome(long resetGeneration, long configGeneration, String config, NativeUpdateResult result) {
            this.resetGeneration = resetGeneration;
            this.configGeneration = configGeneration;
            this.config = config;
            this.result = result;
        }
    }

    private AndroidRound() {
    }

    static String cancellation(RoundHost host, long reset, long generation) {
        return host.configGeneration() != generation ? "config_changed"
            : host.resetGeneration() != reset ? "reset" : null;
    }

    static double engineMillis(long nanos) {
        return (nanos - CLOCK_ORIGIN) / 1e6;
    }

    static long engineNanos(double millis) {
        return CLOCK_ORIGIN + (long) (millis * 1e6);
    }

    static Outcome run(RoundHost host, long deadlineNanos) throws JSONException {
        StartSnapshot snapshot = host.snapshot();
        long reset = snapshot.resetGeneration;
        long generation = snapshot.configGeneration;
        String config = snapshot.config;
        JSONObject event = new JSONObject().put("type", "start")
            .put("config", config == null ? "" : config)
            .put("resetGeneration", reset).put("configGeneration", generation)
            .put("sample", Math.random())
            .put("deadline", deadlineNanos == 0 ? 0 : engineMillis(deadlineNanos));
        String state = null;
        boolean marked = false;
        try {
            while (true) {
                if (state != null && !"committed".equals(event.optString("type"))
                    && (host.configGeneration() != generation
                    || host.resetGeneration() != reset)) {
                    event = new JSONObject().put("type", "cancel").put("reason",
                        host.configGeneration() != generation ? "config_changed" : "reset");
                }
                event.put("now", engineMillis(host.nanoTime())).put("crashHold", host.crashHold());
                String step = host.stepRound(state, event.toString());
                if (step == null) {
                    return new Outcome(reset, generation, config,
                        NativeUpdateResult.of(NativeUpdateResult.FAILED, "internal_error"));
                }
                JSONObject result = new JSONObject(step);
                state = result.getJSONObject("state").toString();
                JSONArray commands = result.getJSONArray("commands");
                if (commands.length() == 0) {
                    throw new JSONException("round produced no command");
                }
                for (int i = 0; i < commands.length(); i++) {
                    JSONObject command = commands.getJSONObject(i);
                    String type = command.getString("type");
                    if ("markIncomplete".equals(type)) {
                        marked = true;
                        host.setKv(NativeCheckOrchestrator.KEY_ROUND_INCOMPLETE, "1");
                    } else if ("finish".equals(type)) {
                        NativeUpdateResult finish = "downloaded".equals(command.optString("status"))
                            ? NativeUpdateResult.downloaded(command.getString("hash"),
                                command.optBoolean("activated"))
                            : NativeUpdateResult.of(command.getString("status"), command.optString("reason"));
                        return new Outcome(reset, generation, config, finish);
                    } else {
                        String reason = cancellation(host, reset, generation);
                        if (reason != null) {
                            event = new JSONObject().put("type", "cancel").put("reason", reason);
                            break;
                        }
                        event = perform(host, command, reset, generation);
                    }
                }
            }
        } finally {
            if (marked) {
                try {
                    host.removeKv(NativeCheckOrchestrator.KEY_ROUND_INCOMPLETE);
                } catch (IllegalStateException ignored) {
                }
            }
        }
    }

    private static JSONObject perform(RoundHost host, JSONObject command, long reset, long generation)
        throws JSONException {
        String type = command.getString("type");
        switch (type) {
            case "collectEnv":
                return new JSONObject().put("type", "env").put("env", host.launchEnv());
            case "http": {
                String text;
                AtomicBoolean finished = new AtomicBoolean(false);
                Thread watcher = new Thread(() -> {
                    while (!finished.get()) {
                        if (cancellation(host, reset, generation) != null) {
                            host.cancelHttp();
                        }
                        try {
                            Thread.sleep(25);
                        } catch (InterruptedException error) {
                            return;
                        }
                    }
                }, "pakta-round-cancel");
                watcher.setDaemon(true);
                watcher.start();
                try {
                    text = host.httpRequest(command.getString("url"),
                        command.optBoolean("post") ? command.getString("body") : null,
                        (long) command.getDouble("timeoutMs"), (long) command.getDouble("callTimeoutMs"));
                } finally {
                    finished.set(true);
                    watcher.interrupt();
                }
                JSONObject event = new JSONObject().put("type", "http");
                if (text != null) {
                    event.put("text", text).put("at", host.wallSeconds());
                }
                return event;
            }
            case "checkInstalled":
                return new JSONObject().put("type", "installed")
                    .put("installed", host.hasCompletedVersion(command.getString("hash")));
            case "download":
                return download(host, command, reset, generation);
            case "commit": {
                JSONObject event = new JSONObject().put("type", "committed");
                try {
                    String hash = command.getString("hash");
                    String info = command.getString("hashInfo");
                    long commandGeneration = command.getLong("configGeneration");
                    boolean ok = host.commit(command.getLong("resetGeneration"), commandGeneration,
                        hash.isEmpty() ? null : hash, info.isEmpty() ? null : info,
                        command.getBoolean("activate"), command.getString("cache"));
                    event.put("ok", ok);
                    if (!ok && host.configGeneration() != commandGeneration) {
                        event.put("reason", "config_changed");
                    }
                } catch (Exception error) {
                    event.put("error", true);
                }
                return event;
            }
            default:
                throw new JSONException("unknown round command: " + type);
        }
    }

    static JSONObject download(RoundHost host, JSONObject command, long reset, long generation)
        throws JSONException {
        long deadline = engineNanos(command.getDouble("deadline"));
        JSONObject event = new JSONObject().put("type", "download");
        if (deadline - host.nanoTime() <= 0) {
            return event.put("timedOut", true);
        }
        CountDownLatch done = new CountDownLatch(1);
        AtomicBoolean succeeded = new AtomicBoolean(false);
        AtomicReference<Throwable> failure = new AtomicReference<>();
        UpdateContext.DownloadFileListener listener = new UpdateContext.DownloadFileListener() {
            @Override
            public void onDownloadCompleted(DownloadTaskParams params) {
                succeeded.set(true);
                done.countDown();
            }

            @Override
            public void onDownloadFailed(Throwable error) {
                failure.set(error);
                done.countDown();
            }
        };
        DownloadTaskParams task = host.start(command.getString("strategy"), command.getString("url"),
            command.getString("hash"), command.optString("originHash", null), listener, deadline);
        boolean settled;
        try {
            settled = done.getCount() == 0;
            while (!settled && cancellation(host, reset, generation) == null) {
                long remaining = deadline - host.nanoTime();
                if (remaining <= 0) {
                    break;
                }
                settled = done.await(Math.min(remaining, TimeUnit.MILLISECONDS.toNanos(25)),
                    TimeUnit.NANOSECONDS);
            }
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            settled = false;
        }
        if (!settled) {
            if (task != null) {
                task.cancel();
            }
            return event.put("timedOut", true);
        }
        event.put("ok", succeeded.get());
        if (failure.get() != null) {
            event.put("code", ErrorCodes.forDownloadFailure(failure.get()));
        }
        return event;
    }
}
