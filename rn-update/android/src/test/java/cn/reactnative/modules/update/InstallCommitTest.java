/**
 * [INPUT]: 依赖真实 UpdateContext/安装 JNI、SharedPreferences 代理与受控线程交错
 * [OUTPUT]: 提供安装提交零写拒绝、配置原子快照及过期代际回归
 * [POS]: Android 提交锁边界测试，使用真实状态方法与 Linux JNI；偏好存储替身不证明设备落盘耐久性
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
package cn.reactnative.modules.update;

import static org.junit.Assert.*;

import android.content.SharedPreferences;
import java.io.File;
import java.io.IOException;
import java.lang.reflect.Field;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class InstallCommitTest {
    @org.junit.BeforeClass public static void requireNative() {
        SharedInstallNativeTest.requireNative();
    }

    @Rule public TemporaryFolder temp = new TemporaryFolder();
    private UpdateContext context;
    private final Map<String, Object> values = new HashMap<>();
    private int commits;
    private Runnable onEdit = () -> {};
    private Runnable onCommit = () -> {};

    private static Field field(String name) throws Exception {
        Field field = UpdateContext.class.getDeclaredField(name);
        field.setAccessible(true);
        return field;
    }

    @Before public void setup() throws Exception {
        Class<?> unsafeClass = Class.forName("sun.misc.Unsafe");
        Field unsafeField = unsafeClass.getDeclaredField("theUnsafe");
        unsafeField.setAccessible(true);
        context = (UpdateContext) unsafeClass.getMethod("allocateInstance", Class.class)
            .invoke(unsafeField.get(null), UpdateContext.class);
        field("rootDir").set(context, temp.getRoot());
        SharedPreferences preferences = (SharedPreferences) Proxy.newProxyInstance(
            SharedPreferences.class.getClassLoader(), new Class<?>[]{SharedPreferences.class},
            (proxy, method, args) -> {
                if (method.getName().equals("getString") || method.getName().equals("getBoolean")) {
                    return values.getOrDefault(args[0], args[1]);
                }
                if (method.getName().equals("getAll")) return new HashMap<>(values);
                if (method.getName().equals("edit")) {
                    onEdit.run();
                    Map<String, Object> pending = new HashMap<>();
                    return Proxy.newProxyInstance(SharedPreferences.Editor.class.getClassLoader(),
                        new Class<?>[]{SharedPreferences.Editor.class}, (editor, operation, parameters) -> {
                            if (operation.getName().startsWith("put")) {
                                pending.put((String) parameters[0], parameters[1]);
                                return editor;
                            }
                            if (operation.getName().equals("remove")) {
                                pending.put((String) parameters[0], null);
                                return editor;
                            }
                            if (operation.getName().equals("commit")) {
                                onCommit.run();
                                commits++;
                                values.putAll(pending);
                                return true;
                            }
                            return null;
                        });
                }
                return null;
            });
        field("sp").set(context, preferences);
    }

    private File installed(String hash) throws Exception {
        File dir = temp.newFolder(hash);
        Files.write(new File(dir, "index.bundlejs").toPath(), "bundle".getBytes(StandardCharsets.UTF_8));
        InstallRecord.seal(dir, hash, "");
        return dir;
    }

    private void mutateOnEdit(File dir) {
        onEdit = () -> {
            try {
                Files.write(new File(dir, "index.bundlejs").toPath(), "BUNDLE".getBytes(StandardCharsets.UTF_8));
            } catch (IOException e) { throw new RuntimeException(e); }
        };
    }

    @Test public void switchRejectsMutationWithoutAnyPersistedState() throws Exception {
        File dir = installed("v");
        mutateOnEdit(dir);
        try {
            context.switchVersion("v");
            fail("changed snapshot accepted");
        } catch (IllegalStateException expected) {
            assertEquals(0, commits);
            assertTrue(values.isEmpty());
        }
    }

    @Test public void nativeCommitRejectsMutationWithoutHashInfoCacheOrState() throws Exception {
        File dir = installed("v");
        mutateOnEdit(dir);
        try {
            context.commitNativeRoundResult(UpdateContext.getResetGeneration(),
                UpdateContext.getNativeConfigGeneration(), "v", "info", true, "cache");
            fail("changed snapshot accepted");
        } catch (IllegalStateException expected) {
            assertEquals(0, commits);
            assertTrue(values.isEmpty());
        }
    }

    @Test public void validSwitchAndNativeCommitPersistOnce() throws Exception {
        installed("v");
        context.switchVersion("v");
        assertEquals("v", values.get("currentVersion"));
        assertEquals(1, commits);
        assertTrue(context.commitNativeRoundResult(UpdateContext.getResetGeneration(),
            UpdateContext.getNativeConfigGeneration(), "v", "info", true, "cache"));
        assertEquals(2, commits);
        assertEquals("info", values.get("hash_v"));
        assertEquals("cache", values.get("nativeCheckResp"));
    }

    @Test public void staleGenerationsPersistNothing() throws Exception {
        installed("v");
        assertFalse(context.commitNativeRoundResult(UpdateContext.getResetGeneration() + 1,
            UpdateContext.getNativeConfigGeneration(), "v", "info", true, "cache"));
        assertFalse(context.commitNativeRoundResult(UpdateContext.getResetGeneration(),
            UpdateContext.getNativeConfigGeneration() + 1, "v", "info", true, "cache"));
        assertEquals(0, commits);
        assertTrue(values.isEmpty());
    }

    @Test public void markerlessCurrentAllowedButCorruptRecordNeverGrandfathered() throws Exception {
        File dir = installed("v");
        Files.delete(new File(dir, InstallRecord.FILE_NAME).toPath());
        values.put("currentVersion", "v");
        context.switchVersion("v");
        assertEquals(1, commits);
        Files.write(new File(dir, InstallRecord.FILE_NAME).toPath(), "{}".getBytes(StandardCharsets.UTF_8));
        try {
            context.switchVersion("v");
            fail("corrupt marker grandfathered");
        } catch (IllegalStateException expected) { assertEquals(1, commits); }
    }

    @Test public void sealThenInvalidationCannotDeleteDestinationOrPromote() throws Exception {
        File staging = temp.newFolder("v.staging");
        Files.write(new File(staging, "index.bundlejs").toPath(), new byte[]{1});
        InstallRecord.seal(staging, "v", "");
        File target = temp.newFolder("v");
        try {
            UpdateContext.promoteInstalledVersion(staging, target, "v", () -> {
                throw new FileOperationException("invalidated");
            });
            fail("invalidated install promoted");
        } catch (IOException expected) {
            assertTrue(staging.isDirectory());
            assertTrue(target.isDirectory());
        }
    }

    @Test public void nativeRoundSnapshotWaitsForConfigurationAndItsGenerations() throws Exception {
        values.put(NativeCheckOrchestrator.KEY_CONFIG, "old-config");
        values.put("uuid", "installation");
        long initialReset = UpdateContext.getResetGeneration();
        long initialConfig = UpdateContext.getNativeConfigGeneration();
        CountDownLatch configurationPending = new CountDownLatch(1);
        CountDownLatch releaseConfiguration = new CountDownLatch(1);
        CountDownLatch snapshotStarted = new CountDownLatch(1);
        CountDownLatch snapshotDone = new CountDownLatch(1);
        AtomicReference<AndroidRound.StartSnapshot> snapshot = new AtomicReference<>();
        AtomicReference<Throwable> failure = new AtomicReference<>();
        onCommit = () -> {
            configurationPending.countDown();
            try {
                if (!releaseConfiguration.await(3, TimeUnit.SECONDS)) {
                    throw new AssertionError("configuration test barrier timed out");
                }
            } catch (InterruptedException error) { throw new AssertionError(error); }
        };
        Thread configure = new Thread(() -> {
            try { context.setNativeConfig("new-config"); }
            catch (Throwable error) { failure.compareAndSet(null, error); }
        });
        Thread reader = new Thread(() -> {
            snapshotStarted.countDown();
            try { snapshot.set(new DeviceRound(context, null).snapshot()); }
            catch (Throwable error) { failure.compareAndSet(null, error); }
            finally { snapshotDone.countDown(); }
        });
        try {
            configure.start();
            assertTrue(configurationPending.await(2, TimeUnit.SECONDS));
            assertEquals(initialReset + 1, UpdateContext.getResetGeneration());
            assertEquals(initialConfig + 1, UpdateContext.getNativeConfigGeneration());
            assertEquals("old-config", context.getKv(NativeCheckOrchestrator.KEY_CONFIG));
            reader.start();
            assertTrue(snapshotStarted.await(2, TimeUnit.SECONDS));
            assertFalse("snapshot must not pair new generations with old config",
                snapshotDone.await(100, TimeUnit.MILLISECONDS));
        } finally {
            releaseConfiguration.countDown();
            configure.join(3000);
            if (reader.getState() != Thread.State.NEW) reader.join(3000);
        }
        assertFalse(configure.isAlive());
        assertFalse(reader.isAlive());
        assertNull(failure.get());
        assertNotNull(snapshot.get());
        assertEquals("new-config", snapshot.get().config);
        assertEquals(initialReset + 1, snapshot.get().resetGeneration);
        assertEquals(initialConfig + 1, snapshot.get().configGeneration);
    }

    @Test public void configurationAfterSnapshotRejectsLateRoundCommitWithoutWrites() {
        values.put(NativeCheckOrchestrator.KEY_CONFIG, "old-config");
        values.put("uuid", "installation");
        AndroidRound.StartSnapshot snapshot = new DeviceRound(context, null).snapshot();
        context.setNativeConfig("new-config");
        int writesAfterConfiguration = commits;
        assertFalse(context.commitNativeRoundResult(snapshot.resetGeneration, snapshot.configGeneration,
            "late", "info", false, "stale-cache"));
        assertEquals(writesAfterConfiguration, commits);
        assertFalse(values.containsKey("hash_late"));
        assertNull(values.get(NativeCheckOrchestrator.KEY_RESP_CACHE));
    }
}
