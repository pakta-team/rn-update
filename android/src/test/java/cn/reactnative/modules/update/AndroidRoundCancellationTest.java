/**
 * [INPUT]: 依赖 AndroidRound、受控配置/代际快照及下载回调替身
 * [OUTPUT]: 提供 HTTP/下载取消、提交拒绝及异常清理回归
 * [POS]: Android 轮次执行器测试，快照与实时失效查询分离，不替代 UpdateContext 锁测试
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
package cn.reactnative.modules.update;

import static org.junit.Assert.*;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class AndroidRoundCancellationTest {
    private static final class Host implements AndroidRound.RoundHost {
        final Map<String, String> kv = new HashMap<>();
        final CountDownLatch cancelled = new CountDownLatch(1);
        final DownloadTaskParams task = new DownloadTaskParams();
        volatile long reset = 3;
        volatile long generation = 5;
        String command = "http";
        boolean configChange;
        boolean throwCollect;
        boolean rejectCommit;
        int steps;
        int commits;

        void change() {
            if (configChange) generation++;
            else reset++;
        }

        public String stepRound(String state, String text) {
            try {
                JSONObject event = new JSONObject(text);
                JSONArray commands = new JSONArray();
                if (steps++ == 0) {
                    commands.put(new JSONObject().put("type", "markIncomplete"));
                    JSONObject io = new JSONObject().put("type", command);
                    if ("http".equals(command)) io.put("url", "https://example.com")
                        .put("timeoutMs", 1000).put("callTimeoutMs", 1000);
                    if ("download".equals(command)) io.put("strategy", "full").put("hash", "h2")
                        .put("url", "https://example.com/full").put("deadline", AndroidRound.engineMillis(nanoTime()) + 1000);
                    if ("commit".equals(command)) io.put("resetGeneration", reset).put("configGeneration", generation)
                        .put("hash", "h2").put("hashInfo", "{}").put("activate", true).put("cache", "{}");
                    commands.put(io);
                } else {
                    if ("commit".equals(command)) {
                        assertEquals("committed", event.getString("type"));
                        assertFalse(event.getBoolean("ok"));
                    } else assertEquals("cancel", event.getString("type"));
                    commands.put(new JSONObject().put("type", "finish").put("status", "cancelled")
                        .put("reason", event.optString("reason", "reset")));
                }
                return new JSONObject().put("state", new JSONObject()).put("commands", commands).toString();
            } catch (org.json.JSONException error) { throw new AssertionError(error); }
        }
        public long nanoTime() { return System.nanoTime(); }
        public boolean crashHold() { return false; }
        public long resetGeneration() { return reset; }
        public long configGeneration() { return generation; }
        public AndroidRound.StartSnapshot snapshot() {
            return new AndroidRound.StartSnapshot(reset, generation, "{}");
        }
        public void setKv(String key, String value) { kv.put(key, value); }
        public void removeKv(String key) { kv.remove(key); }
        public JSONObject launchEnv() {
            if (throwCollect) throw new IllegalStateException("environment unavailable");
            return new JSONObject();
        }
        public String httpRequest(String url, String body, long timeout, long callTimeout) {
            change();
            try { assertTrue("HTTP cancellation is bounded", cancelled.await(2, TimeUnit.SECONDS)); }
            catch (InterruptedException error) { throw new AssertionError(error); }
            return "{}";
        }
        public void cancelHttp() { cancelled.countDown(); }
        public double wallSeconds() { return 0; }
        public boolean hasCompletedVersion(String hash) { return false; }
        public boolean commit(long reset, long generation, String hash, String info, boolean activate, String cache) {
            commits++;
            if (rejectCommit) change();
            return false;
        }
        public DownloadTaskParams start(String strategy, String url, String hash, String origin,
            UpdateContext.DownloadFileListener listener, long deadline) {
            change();
            return task;
        }
    }

    private void cancels(String command, boolean configChange) throws Exception {
        Host host = new Host();
        host.command = command;
        host.configChange = configChange;
        AndroidRound.Outcome outcome = AndroidRound.run(host, 0);
        assertEquals(NativeUpdateResult.CANCELLED, outcome.result.getStatus());
        assertEquals(configChange ? "config_changed" : "reset", outcome.result.getReason());
        assertTrue(host.kv.isEmpty());
        assertEquals(0, host.commits);
        if ("download".equals(command)) assertTrue(host.task.isCancelled());
    }

    @Test public void resetCancelsActiveHttp() throws Exception { cancels("http", false); }
    @Test public void configCancelsActiveHttp() throws Exception { cancels("http", true); }
    @Test public void resetCancelsPendingDownload() throws Exception { cancels("download", false); }
    @Test public void configCancelsPendingDownload() throws Exception { cancels("download", true); }

    @Test public void commitRejectionKeepsConfigReason() throws Exception {
        Host host = new Host();
        host.command = "commit";
        host.configChange = true;
        host.rejectCommit = true;
        assertEquals("config_changed", AndroidRound.run(host, 0).result.getReason());
        assertEquals(1, host.commits);
        assertTrue(host.kv.isEmpty());
    }

    @Test public void environmentFailureClearsBreadcrumb() throws Exception {
        Host host = new Host();
        host.command = "collectEnv";
        host.throwCollect = true;
        try {
            AndroidRound.run(host, 0);
            fail("environment failure must escape to process guard");
        } catch (IllegalStateException expected) {
            assertTrue(host.kv.isEmpty());
        }
    }
}
