/**
 * [INPUT]: 依赖共享轮次向量、AndroidRound 与脚本化 IO/启动快照
 * [OUTPUT]: 提供 Android 可产生轨迹的命令、事件和结果回放
 * [POS]: Android 轮次适配契约测试；引擎与 IO 为向量替身，启动使用同一配置/双代际快照
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
package cn.reactnative.modules.update;

import static org.junit.Assert.*;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.junit.runners.Parameterized;

@RunWith(Parameterized.class)
public class SyncRoundReplayTest {
    private final JSONArray steps;

    public SyncRoundReplayTest(String name, JSONArray steps) {
        this.steps = steps;
    }

    private static Object expand(Object value, JSONObject fixtures) throws Exception {
        if (value instanceof String && ((String) value).startsWith("@")) {
            return fixtures.get(((String) value).substring(1));
        }
        if (value instanceof JSONArray) {
            JSONArray result = new JSONArray();
            JSONArray array = (JSONArray) value;
            for (int i = 0; i < array.length(); i++) result.put(expand(array.get(i), fixtures));
            return result;
        }
        if (value instanceof JSONObject) {
            JSONObject result = new JSONObject();
            JSONObject object = (JSONObject) value;
            for (Iterator<String> keys = object.keys(); keys.hasNext();) {
                String key = keys.next();
                result.put(key, expand(object.get(key), fixtures));
            }
            return result;
        }
        return value;
    }

    @Parameterized.Parameters(name = "{0}")
    public static Collection<Object[]> rounds() throws Exception {
        String path = "cpp/update_flow_core/tests/round-engine-vectors.json";
        File dir = new File(System.getProperty("user.dir")).getAbsoluteFile();
        while (dir != null && !new File(dir, path).isFile()) dir = dir.getParentFile();
        if (dir == null) throw new IOException("Missing " + path);
        JSONObject vectors = new JSONObject(new String(Files.readAllBytes(new File(dir, path).toPath()),
            StandardCharsets.UTF_8));
        JSONArray rounds = vectors.getJSONArray("rounds");
        List<Object[]> result = new ArrayList<>();
        for (int i = 0; i < rounds.length(); i++) {
            JSONObject round = rounds.getJSONObject(i);
            JSONArray steps = (JSONArray) expand(round.getJSONArray("steps"), vectors.getJSONObject("fixtures"));
            boolean replayable = !round.getString("name").contains("internal_error");
            for (int j = 0; j < steps.length(); j++) {
                JSONObject event = steps.getJSONObject(j).getJSONObject("event");
                String type = event.optString("type");
                replayable &= (j == 0) == "start".equals(type) && !event.optBoolean("forceActivate")
                    && !event.has("activated") && !("download".equals(type) && !event.optBoolean("ok")
                    && !event.optBoolean("timedOut") && !event.has("code"));
            }
            if (replayable) result.add(new Object[] {round.getString("name"), steps});
        }
        assertTrue("Android vector coverage", result.size() >= 25);
        return result;
    }

    private final class Replay implements AndroidRound.RoundHost {
        int next;
        boolean held;
        boolean commandClock;
        boolean commitCalled;
        final Map<String, String> kv = new HashMap<>();
        final List<String> actualIo = new ArrayList<>();
        final List<String> expectedIo = new ArrayList<>();
        final List<DownloadTaskParams> pending = new ArrayList<>();
        JSONObject expected() { return next < steps.length() ? steps.optJSONObject(next).optJSONObject("event") : new JSONObject(); }
        JSONObject start() { return steps.optJSONObject(0).optJSONObject("event"); }
        public long nanoTime() {
            if (commandClock) {
                commandClock = false;
                return AndroidRound.engineNanos(steps.optJSONObject(next - 1).optJSONObject("event").optDouble("now"));
            }
            return AndroidRound.engineNanos(expected().optDouble("now"));
        }
        public boolean crashHold() { held |= expected().optBoolean("crashHold"); return held; }
        public long resetGeneration() { return start().optLong("resetGeneration"); }
        public long configGeneration() {
            return start().optLong("configGeneration")
                + (commitCalled && "config_changed".equals(expected().optString("reason")) ? 1 : 0);
        }
        public AndroidRound.StartSnapshot snapshot() {
            return new AndroidRound.StartSnapshot(resetGeneration(), configGeneration(),
                kv.get(NativeCheckOrchestrator.KEY_CONFIG));
        }
        public void setKv(String key, String value) { kv.put(key, value); }
        public void removeKv(String key) { kv.remove(key); }
        public JSONObject launchEnv() { return expected().optJSONObject("env"); }
        public double wallSeconds() { return expected().optDouble("at", 1700000000.9); }
        public boolean hasCompletedVersion(String hash) { actualIo.add("installed " + hash); return expected().optBoolean("installed"); }
        public void cancelHttp() { }
        public String httpRequest(String url, String body, long timeout, long callTimeout) {
            actualIo.add("http " + url + " " + body + " " + timeout + " " + callTimeout);
            return expected().has("text") ? expected().optString("text") : null;
        }
        public boolean commit(long reset, long generation, String hash, String info, boolean activate, String cache) {
            commitCalled = true;
            actualIo.add("commit " + reset + " " + generation + " " + hash + " " + info + " " + activate + " " + cache);
            if (expected().optBoolean("error")) throw new IllegalStateException("commit failed");
            return expected().optBoolean("ok");
        }
        public DownloadTaskParams start(String strategy, String url, String hash, String origin,
            UpdateContext.DownloadFileListener listener, long deadline) {
            actualIo.add("download " + strategy + " " + url + " " + hash + " " + origin + " " + deadline);
            if (expected().optBoolean("timedOut")) {
                DownloadTaskParams task = new DownloadTaskParams();
                pending.add(task);
                return task;
            }
            if (expected().optBoolean("ok")) listener.onDownloadCompleted(new DownloadTaskParams());
            else {
                String code = expected().optString("code");
                Throwable error = "PATCH_FAILED".equals(code) ? new PatchFailedException("patch", null)
                    : "FILE_OPERATION_FAILED".equals(code) ? new FileOperationException("disk") : new IOException("network");
                assertEquals(code, ErrorCodes.forDownloadFailure(error));
                listener.onDownloadFailed(error);
            }
            return null;
        }
        public String stepRound(String state, String text) {
            try {
                return replayStep(state, text);
            } catch (org.json.JSONException error) {
                throw new AssertionError(error);
            }
        }
        private String replayStep(String state, String text) throws org.json.JSONException {
            JSONObject sent = new JSONObject(text);
            JSONObject event = expected();
            for (String key : new String[] {"type", "text", "installed", "code", "timedOut", "reason", "error"}) {
                assertEquals("event " + next + " " + key, event.opt(key), sent.opt(key));
            }
            assertEquals(event.optBoolean("ok"), sent.optBoolean("ok"));
            assertEquals(event.optDouble("now"), sent.getDouble("now"), 0.001);
            assertEquals(held, sent.getBoolean("crashHold"));
            if (next == 0) {
                assertEquals(event.getString("config"), sent.getString("config"));
                assertEquals(resetGeneration(), sent.getLong("resetGeneration"));
                assertEquals(configGeneration(), sent.getLong("configGeneration"));
                assertEquals(event.getDouble("deadline"), sent.getDouble("deadline"), 0.001);
                assertTrue(sent.getDouble("sample") >= 0 && sent.getDouble("sample") < 1);
            }
            JSONArray commands = steps.getJSONObject(next++).getJSONArray("commands");
            for (int i = 0; i < commands.length(); i++) {
                JSONObject c = commands.getJSONObject(i);
                switch (c.getString("type")) {
                    case "http": expectedIo.add("http " + c.getString("url") + " "
                        + (c.optBoolean("post") ? c.getString("body") : null) + " "
                        + (long) c.getDouble("timeoutMs") + " " + (long) c.getDouble("callTimeoutMs")); break;
                    case "checkInstalled": expectedIo.add("installed " + c.getString("hash")); break;
                    case "download": commandClock = true; expectedIo.add("download " + c.getString("strategy") + " " + c.getString("url")
                        + " " + c.getString("hash") + " " + c.optString("originHash", null) + " "
                        + AndroidRound.engineNanos(c.getDouble("deadline"))); break;
                    case "commit": expectedIo.add("commit " + c.getLong("resetGeneration") + " "
                        + c.getLong("configGeneration") + " " + (c.getString("hash").isEmpty() ? null : c.getString("hash"))
                        + " " + (c.getString("hashInfo").isEmpty() ? null : c.getString("hashInfo")) + " "
                        + c.getBoolean("activate") + " " + c.getString("cache")); break;
                    default: break;
                }
            }
            return new JSONObject().put("state", new JSONObject().put("step", next)).put("commands", commands).toString();
        }
    }

    @Test
    public void replaysCommandsAndEvents() throws Exception {
        Replay host = new Replay();
        JSONObject start = host.start();
        host.kv.put(NativeCheckOrchestrator.KEY_CONFIG, start.getString("config"));
        double deadline = start.getDouble("deadline");
        AndroidRound.Outcome outcome = AndroidRound.run(host, deadline == 0 ? 0 : AndroidRound.engineNanos(deadline));
        assertEquals(steps.length(), host.next);
        assertEquals(host.expectedIo, host.actualIo);
        assertFalse(host.kv.containsKey(NativeCheckOrchestrator.KEY_ROUND_INCOMPLETE));
        for (DownloadTaskParams task : host.pending) assertTrue(task.isCancelled());
        JSONArray last = steps.getJSONObject(steps.length() - 1).getJSONArray("commands");
        JSONObject finish = last.getJSONObject(last.length() - 1);
        assertEquals(finish.getString("status"), outcome.result.getStatus());
        assertEquals(finish.optString("reason"), outcome.result.getReason());
        assertEquals(finish.optString("hash"), outcome.result.getHash());
        assertEquals(finish.optBoolean("activated"), outcome.result.isActivated());
    }
}
