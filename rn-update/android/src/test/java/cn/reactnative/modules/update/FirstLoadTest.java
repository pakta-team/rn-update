package cn.reactnative.modules.update;

import static org.junit.Assert.*;

import android.app.Application;
import android.content.SharedPreferences;
import java.io.File;
import java.lang.reflect.Field;
import java.lang.reflect.Proxy;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class FirstLoadTest {
    @Rule public TemporaryFolder temp = new TemporaryFolder();
    private final Map<String, Object> values = new HashMap<>();
    private final List<Application.ActivityLifecycleCallbacks> callbacks = new ArrayList<>();
    private SharedPreferences preferences;
    private int commits;
    private int registrations;
    private int removals;

    static class LaunchContext extends UpdateContext {
        boolean foreground;

        LaunchContext() { super(null); }

        @Override boolean isProcessForeground() { return foreground; }
    }

    class LaunchApplication extends Application {
        @Override public void registerActivityLifecycleCallbacks(ActivityLifecycleCallbacks callback) {
            registrations++;
            callbacks.add(callback);
        }

        @Override public void unregisterActivityLifecycleCallbacks(ActivityLifecycleCallbacks callback) {
            removals++;
            assertTrue(callbacks.remove(callback));
        }
    }

    private static <T> T allocate(Class<T> type) throws Exception {
        Class<?> unsafe = Class.forName("sun.misc.Unsafe");
        Field field = unsafe.getDeclaredField("theUnsafe");
        field.setAccessible(true);
        return type.cast(unsafe.getMethod("allocateInstance", Class.class).invoke(field.get(null), type));
    }

    private static void set(UpdateContext context, String name, Object value) throws Exception {
        Field field = UpdateContext.class.getDeclaredField(name);
        field.setAccessible(true);
        field.set(context, value);
    }

    @Before public void setup() throws Exception {
        preferences = (SharedPreferences) Proxy.newProxyInstance(
            SharedPreferences.class.getClassLoader(), new Class<?>[]{SharedPreferences.class},
            (proxy, method, args) -> {
                if (method.getName().equals("getString") || method.getName().equals("getBoolean")) {
                    return values.getOrDefault(args[0], args[1]);
                }
                if (method.getName().equals("edit")) {
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
                                commits++;
                                pending.forEach((key, value) -> {
                                    if (value == null) values.remove(key);
                                    else values.put(key, value);
                                });
                                return true;
                            }
                            throw new AssertionError(operation.getName());
                        });
                }
                throw new AssertionError(method.getName());
            });
        values.put("currentVersion", "new");
        values.put("lastVersion", "old");
        values.put("firstTime", true);
        values.put("firstTimeOk", false);
        for (String version : new String[]{"new", "old"}) {
            File dir = temp.newFolder(version);
            Files.write(new File(dir, "index.bundlejs").toPath(), new byte[]{1});
        }
    }

    private LaunchContext process(boolean foreground) throws Exception {
        LaunchContext context = allocate(LaunchContext.class);
        context.foreground = foreground;
        set(context, "context", new LaunchApplication());
        set(context, "rootDir", temp.getRoot());
        set(context, "sp", preferences);
        return context;
    }

    private void loads(LaunchContext context, String version) {
        assertEquals(new File(temp.getRoot(), version + "/index.bundlejs").toString(),
            context.getBundleUrl("assets://index.android.bundle"));
    }

    @Test public void backgroundRestartsPreserveFirstTimeUntilForegroundLaunch() throws Exception {
        loads(process(false), "new");
        assertEquals(true, values.get("firstTime"));
        assertEquals(false, values.get("firstTimeOk"));
        assertTrue(process(false).consumeLaunchMarkers().isFirstTime);
        loads(process(false), "new");
        assertEquals(true, values.get("firstTime"));
        loads(process(true), "new");
        assertEquals(false, values.get("firstTime"));
        assertEquals(false, values.get("firstTimeOk"));
        assertNull(values.get("rolledBackVersion"));
    }

    @Test public void activityStartsDeferredLoadOnceAndNextProcessRollsBack() throws Exception {
        LaunchContext context = process(false);
        loads(context, "new");
        loads(context, "new");
        assertEquals(1, registrations);
        Application.ActivityLifecycleCallbacks callback = callbacks.get(0);
        int before = commits;
        callback.onActivityCreated(null, null);
        callback.onActivityResumed(null);
        callback.onActivityPaused(null);
        callback.onActivityStopped(null);
        callback.onActivitySaveInstanceState(null, null);
        callback.onActivityDestroyed(null);
        assertEquals(before, commits);
        callback.onActivityStarted(null);
        assertEquals(before + 1, commits);
        assertEquals(false, values.get("firstTime"));
        assertEquals(false, values.get("firstTimeOk"));
        assertEquals(1, removals);
        assertTrue(callbacks.isEmpty());
        loads(context, "new");
        assertEquals(before + 1, commits);
        loads(process(true), "old");
        assertEquals("new", values.get("rolledBackVersion"));
    }

    @Test public void consumedJsMarkerDoesNotPreventActivityBookkeeping() throws Exception {
        LaunchContext context = process(false);
        loads(context, "new");
        assertTrue(context.consumeLaunchMarkers().isFirstTime);
        assertFalse(context.consumeLaunchMarkers().isFirstTime);
        callbacks.get(0).onActivityStarted(null);
        assertEquals(false, values.get("firstTime"));
        assertEquals(false, values.get("firstTimeOk"));
        assertFalse(context.consumeLaunchMarkers().isFirstTime);
    }

    @Test public void staleActivityCannotConsumeAnotherPendingVersion() throws Exception {
        LaunchContext context = process(false);
        loads(context, "new");
        values.put("currentVersion", "other");
        Map<String, Object> before = new HashMap<>(values);
        int writes = commits;
        callbacks.get(0).onActivityStarted(null);
        assertEquals(before, values);
        assertEquals(writes, commits);
        assertTrue(callbacks.isEmpty());
    }

    @Test public void activityAfterFirstTimeClearedDoesNotWrite() throws Exception {
        LaunchContext context = process(false);
        loads(context, "new");
        values.put("firstTime", false);
        int before = commits;
        callbacks.get(0).onActivityStarted(null);
        assertEquals(before, commits);
        assertTrue(callbacks.isEmpty());
    }

    @Test public void activityAfterResetToPackagedStateDoesNotWrite() throws Exception {
        LaunchContext context = process(false);
        loads(context, "new");
        values.remove("currentVersion");
        int before = commits;
        callbacks.get(0).onActivityStarted(null);
        assertEquals(before, commits);
        assertEquals(true, values.get("firstTime"));
        assertTrue(callbacks.isEmpty());
    }

    @Test public void backgroundRestartsWithoutActivityNeverRollBack() throws Exception {
        for (int restart = 0; restart < 3; restart++) {
            LaunchContext context = process(false);
            loads(context, "new");
            assertTrue(context.consumeLaunchMarkers().isFirstTime);
            assertEquals(true, values.get("firstTime"));
            assertEquals(false, values.get("firstTimeOk"));
            assertEquals("new", values.get("currentVersion"));
            assertEquals("old", values.get("lastVersion"));
            assertNull(values.get("rolledBackVersion"));
        }
        assertEquals(3, registrations);
        assertEquals(0, removals);
    }

    @Test public void activityAfterSuccessDoesNotReopenFailureWindow() throws Exception {
        LaunchContext context = process(false);
        loads(context, "new");
        values.put("firstTime", false);
        values.put("firstTimeOk", true);
        Map<String, Object> before = new HashMap<>(values);
        int writes = commits;
        callbacks.get(0).onActivityStarted(null);
        assertEquals(before, values);
        assertEquals(writes, commits);
        assertEquals(1, removals);
        assertTrue(callbacks.isEmpty());
        loads(process(true), "new");
        assertNull(values.get("rolledBackVersion"));
    }

    @Test public void foregroundResolutionBeforeActivityDoesNotConsumeTwice() throws Exception {
        LaunchContext context = process(false);
        loads(context, "new");
        context.foreground = true;
        loads(context, "new");
        Map<String, Object> before = new HashMap<>(values);
        int writes = commits;
        callbacks.get(0).onActivityStarted(null);
        assertEquals(before, values);
        assertEquals(writes, commits);
        assertEquals(1, removals);
        assertTrue(callbacks.isEmpty());
        loads(context, "new");
        assertEquals(writes, commits);
    }

    @Test public void foregroundConsumesOnceWithoutRegisteringActivity() throws Exception {
        LaunchContext context = process(true);
        loads(context, "new");
        assertEquals(1, commits);
        assertEquals(0, registrations);
        assertEquals(false, values.get("firstTime"));
        assertTrue(context.consumeLaunchMarkers().isFirstTime);
        int before = commits;
        loads(context, "new");
        assertEquals(before, commits);
        assertNull(values.get("rolledBackVersion"));
    }
}
