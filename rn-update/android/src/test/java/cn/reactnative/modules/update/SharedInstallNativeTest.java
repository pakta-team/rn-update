package cn.reactnative.modules.update;

import static org.junit.Assert.*;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class SharedInstallNativeTest {
    @org.junit.BeforeClass public static void requireNative() {
        org.junit.Assume.assumeTrue("JNI host library requires Linux test harness or explicit host library",
            System.getProperty("os.name").equals("Linux") || Boolean.getBoolean("pakta.install.native"));
    }

    @Rule public TemporaryFolder temp = new TemporaryFolder();

    private File bundle(File dir) throws Exception {
        File bundle = new File(dir, "index.bundlejs");
        Files.write(bundle.toPath(), "bundle".getBytes(StandardCharsets.UTF_8));
        return bundle;
    }

    private interface Action { void run() throws Exception; }

    private void rejects(Action action) throws Exception {
        try {
            action.run();
            fail("operation must reject");
        } catch (IOException expected) {
            assertNotNull(expected.getMessage());
        }
    }

    @Test public void sealPromoteAndUnicodePathsUseRealJni() throws Exception {
        File stage = temp.newFolder("版本😀.staging");
        File bundle = bundle(stage);
        InstallRecord.seal(stage, "版本😀", "artifact");
        File target = new File(temp.getRoot(), "版本😀");
        InstallRecord.promote(stage, target);
        assertTrue(InstallRecord.isComplete(target, "版本😀"));
        try (InstallRecord.Activation snapshot = InstallRecord.checkActivation(target, "版本😀",
                new File(target, bundle.getName()), false)) {
            snapshot.assertUnchanged(false);
        }
        File second = temp.newFolder("second.staging");
        bundle(second);
        InstallRecord.seal(second, "版本😀", "");
        rejects(() -> InstallRecord.promote(second, target));
        assertTrue(second.exists());
    }

    @Test public void snapshotDetectsSameLengthBundleAndRecordChanges() throws Exception {
        File dir = temp.newFolder();
        File bundle = bundle(dir);
        InstallRecord.seal(dir, "v", "");
        try (InstallRecord.Activation snapshot = InstallRecord.checkActivation(dir, "v", bundle, false)) {
            Files.write(bundle.toPath(), "BUNDLE".getBytes(StandardCharsets.UTF_8));
            rejects(() -> snapshot.assertUnchanged(false));
        }
        InstallRecord.seal(dir, "v", "");
        try (InstallRecord.Activation snapshot = InstallRecord.checkActivation(dir, "v", bundle, false)) {
            Files.write(new File(dir, InstallRecord.FILE_NAME).toPath(), new byte[0]);
            rejects(() -> snapshot.assertUnchanged(false));
        }
    }

    @Test public void legacyAndGrandfatheredStillRequireUnchangedFiles() throws Exception {
        File dir = temp.newFolder();
        File bundle = bundle(dir);
        rejects(() -> InstallRecord.checkActivation(dir, "v", bundle, false));
        try (InstallRecord.Activation snapshot = InstallRecord.checkActivation(dir, "v", bundle, true)) {
            snapshot.assertUnchanged(true);
            rejects(() -> snapshot.assertUnchanged(false));
            Files.write(new File(dir, InstallRecord.FILE_NAME).toPath(), "{}".getBytes(StandardCharsets.UTF_8));
            rejects(() -> snapshot.assertUnchanged(true));
        }
        rejects(() -> InstallRecord.checkActivation(dir, "v", bundle, true));
        Files.write(new File(dir, InstallRecord.FILE_NAME).toPath(), new byte[0]);
        try (InstallRecord.Activation snapshot = InstallRecord.checkActivation(dir, "v", bundle, false)) {
            snapshot.assertUnchanged(false);
            Files.delete(bundle.toPath());
            rejects(() -> snapshot.assertUnchanged(false));
        }
    }

    @Test public void closedAndForgedSnapshotsReject() throws Exception {
        File dir = temp.newFolder();
        File bundle = bundle(dir);
        InstallRecord.seal(dir, "v", "");
        InstallRecord.Activation snapshot = InstallRecord.checkActivation(dir, "v", bundle, false);
        snapshot.close();
        snapshot.close();
        rejects(() -> snapshot.assertUnchanged(false));
        rejects(() -> NativeInstall.unchanged(Long.MAX_VALUE, true));
    }

    @Test public void manifestValidatesCrcHbcDeletesAndReservedAncestors() throws Exception {
        JSONObject parsed = new JSONObject(NativeInstall.execute("manifest",
            "{\"copies\":{\"a\":null},\"copiesCrc\":{\"a\":4294967295},\"deletes\":[\"old\"],"
            + "\"hbcTransform\":{\"index.bundlejs.patch\":{\"schema\":1}}}", null, null, null));
        assertEquals("a", parsed.getJSONObject("copies").getString("a"));
        assertEquals(4294967295L, parsed.getJSONObject("copiesCrc").getLong("a"));
        assertEquals("old", parsed.getJSONArray("deletes").getString(0));
        assertTrue(parsed.getJSONObject("hbcTransform").has("index.bundlejs.patch"));
        for (String invalid : new String[] {
            "{\"copiesCrc\":{\"a\":1.5}}", "{\"deletes\":[\"assets/.pakta-x/file\"]}",
            "{\"copies\":{\"a\":\"same\",\"b\":\"same\"},\"copiesCrc\":{\"a\":1,\"b\":2}}",
            "{\"hbcTransform\":{\"index.bundlejs.patch\":1}}", "{} trailing"}) {
            rejects(() -> NativeInstall.execute("manifest", invalid, null, null, null));
        }
    }

    @Test public void archiveExactRatioAndDirectoryAuditRejectUnsafeFiles() throws Exception {
        long size = 1048601;
        rejects(() -> NativeInstall.inspect(new String[]{"a"}, new long[]{size}, new long[]{10486}, size));
        assertEquals(size, NativeInstall.inspect(new String[]{"a"}, new long[]{size}, new long[]{10487}, size));
        File dir = temp.newFolder();
        File bundle = bundle(dir);
        NativeInstall.execute("audit", dir.getAbsolutePath(), "100", null, null);
        Files.createSymbolicLink(new File(dir, "link").toPath(), bundle.toPath());
        rejects(() -> NativeInstall.execute("audit", dir.getAbsolutePath(), "100", null, null));
        rejects(() -> NativeInstall.inspect(new String[]{"a"}, new long[]{-1}, new long[]{1}, 100));
        rejects(() -> NativeInstall.inspect(new String[]{"a"}, new long[0], new long[]{1}, 100));
    }
}
