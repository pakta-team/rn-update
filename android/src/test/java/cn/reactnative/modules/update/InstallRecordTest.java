/**
 * [INPUT]: 依赖 junit4、TemporaryFolder 与 InstallRecord 落盘实现
 * [OUTPUT]: 验证完成记录的写入/读取/校验与摘要派生的真实磁盘行为
 * [POS]: android/src/test 的 JVM 单元测试，守护两阶段安装记录的完整性
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
package cn.reactnative.modules.update;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import org.json.JSONException;
import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class InstallRecordTest {
    @org.junit.BeforeClass public static void requireNative() {
        SharedInstallNativeTest.requireNative();
    }

    private static final String HASH = "0123456789abcdef";
    private static final String DIGEST = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    private static final String[] NONEMPTY_EMPTY_OBJECTS = {"{}", " { } ", "\n{\r\n\t}\n"};

    @Rule
    public TemporaryFolder temp = new TemporaryFolder();

    private static void writeFile(File file, byte[] bytes) throws IOException {
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(bytes);
        }
    }

    private static String sha256Hex(byte[] bytes) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes);
        StringBuilder hex = new StringBuilder();
        for (byte b : digest) {
            hex.append(String.format("%02x", b));
        }
        return hex.toString();
    }

    @Test
    public void buildWritesSchemaAndDigests() throws Exception {
        JSONObject full = new JSONObject(InstallRecord.build(HASH, DIGEST, "aa"));
        assertEquals(InstallRecord.SCHEMA, full.getInt("schema"));
        assertEquals(HASH, full.getString("versionHash"));
        assertEquals(DIGEST, full.getString("bundleSha256"));
        assertEquals("aa", full.getString("artifactSha256"));

        // artifactSha256 is optional diagnostics.
        JSONObject noArtifact = new JSONObject(InstallRecord.build(HASH, DIGEST, null));
        assertEquals(DIGEST, noArtifact.getString("bundleSha256"));
        assertFalse(noArtifact.has("artifactSha256"));
    }

    @Test
    public void buildRefusesARecordWithoutBundleDigest() throws Exception {
        for (String missing : new String[] {"", null}) {
            try {
                InstallRecord.build(HASH, missing, "aa");
                fail("a record without bundleSha256 must not be built");
            } catch (IOException expected) {
                assertTrue(expected.getMessage().contains("bundle digest"));
            }
        }
    }

    @Test
    public void writeThenReadRoundTrips() throws Exception {
        File dir = temp.newFolder();
        writeFile(new File(dir, "index.bundlejs"), new byte[0]);
        InstallRecord.write(dir, InstallRecord.build(HASH, DIGEST, "aa"));
        assertTrue(new File(dir, InstallRecord.FILE_NAME).isFile());

        JSONObject record = InstallRecord.read(dir);
        assertNotNull(record);
        assertEquals(HASH, record.getString("versionHash"));
        assertTrue(InstallRecord.isComplete(dir, HASH));
        assertFalse(InstallRecord.isComplete(dir, "someotherhash"));
    }

    @Test
    public void readHandlesAbsentLegacyAndMalformedRecords() throws Exception {
        File dir = temp.newFolder();
        assertNull(InstallRecord.read(dir));
        assertFalse(InstallRecord.isComplete(dir, HASH));

        // Legacy marker: an empty file counts as complete for any hash.
        writeFile(new File(dir, "index.bundlejs"), new byte[0]);
        File marker = new File(dir, InstallRecord.FILE_NAME);
        writeFile(marker, new byte[0]);
        JSONObject legacy = InstallRecord.read(dir);
        assertNotNull(legacy);
        assertEquals(0, legacy.length());
        assertTrue(InstallRecord.isComplete(dir, HASH));

        writeFile(marker, "not json".getBytes(StandardCharsets.UTF_8));
        assertNull(InstallRecord.read(dir));
        assertFalse(InstallRecord.isComplete(dir, HASH));

        byte[] oversized = new byte[64 * 1024 + 1];
        Arrays.fill(oversized, (byte) ' ');
        writeFile(marker, oversized);
        assertNull(InstallRecord.read(dir));
    }

    @Test
    public void readRejectsNonemptyEmptyObjects() throws Exception {
        File dir = temp.newFolder();
        File marker = new File(dir, InstallRecord.FILE_NAME);
        for (String content : NONEMPTY_EMPTY_OBJECTS) {
            writeFile(marker, content.getBytes(StandardCharsets.UTF_8));
            assertTrue(marker.length() > 0);
            assertNull(content, InstallRecord.read(dir));
        }
    }

    @Test
    public void isCompleteRejectsNonemptyEmptyObjects() throws Exception {
        File dir = temp.newFolder();
        File marker = new File(dir, InstallRecord.FILE_NAME);
        for (String content : NONEMPTY_EMPTY_OBJECTS) {
            writeFile(marker, content.getBytes(StandardCharsets.UTF_8));
            assertFalse(content, InstallRecord.isComplete(dir, HASH));
        }
    }

    @Test
    public void verifyForActivationRejectsNonemptyEmptyObjects() throws Exception {
        File dir = temp.newFolder();
        File bundle = new File(dir, "index.bundlejs");
        writeFile(bundle, "tampered".getBytes(StandardCharsets.UTF_8));
        File marker = new File(dir, InstallRecord.FILE_NAME);
        for (String content : NONEMPTY_EMPTY_OBJECTS) {
            writeFile(marker, content.getBytes(StandardCharsets.UTF_8));
            try {
                InstallRecord.verifyForActivation(dir, HASH, bundle);
                fail("nonempty empty object must not activate: " + content);
            } catch (IOException expected) {
                assertTrue(expected.getMessage().contains("completion record"));
            }
        }
    }

    @Test
    public void isCompleteRequiresMatchingSchemaAndHash() throws Exception {
        File dir = temp.newFolder();
        File marker = new File(dir, InstallRecord.FILE_NAME);
        writeFile(marker, ("{\"schema\":" + (InstallRecord.SCHEMA + 1)
            + ",\"versionHash\":\"" + HASH + "\"}").getBytes(StandardCharsets.UTF_8));
        assertFalse(InstallRecord.isComplete(dir, HASH));

        writeFile(marker, ("{\"schema\":" + InstallRecord.SCHEMA
            + ",\"versionHash\":\"other\"}").getBytes(StandardCharsets.UTF_8));
        assertFalse(InstallRecord.isComplete(dir, HASH));
    }

    @Test
    public void verifyForActivationChecksTheBundleDigest() throws Exception {
        File dir = temp.newFolder();
        File bundle = new File(dir, "index.bundlejs");
        byte[] bundleBytes = "var a = 1;".getBytes(StandardCharsets.UTF_8);
        writeFile(bundle, bundleBytes);

        InstallRecord.write(dir, InstallRecord.build(HASH, sha256Hex(bundleBytes), ""));
        InstallRecord.verifyForActivation(dir, HASH, bundle);

        // Digest stored upper-case still matches.
        InstallRecord.write(dir, InstallRecord.build(HASH, sha256Hex(bundleBytes).toUpperCase(), ""));
        InstallRecord.verifyForActivation(dir, HASH, bundle);

        writeFile(bundle, "var a = 2;".getBytes(StandardCharsets.UTF_8));
        try {
            InstallRecord.verifyForActivation(dir, HASH, bundle);
            fail("tampered bundle must not activate");
        } catch (IOException expected) {
            assertTrue(expected.getMessage().contains("digest mismatch"));
        }
    }

    @Test
    public void verifyForActivationAcceptsLegacyMarkersAndRejectsDigestlessRecords() throws Exception {
        File dir = temp.newFolder();
        File bundle = new File(dir, "index.bundlejs");
        writeFile(bundle, "x".getBytes(StandardCharsets.UTF_8));

        // 旧 SDK 写出的无摘要 schema-1 记录不得激活。
        JSONObject digestless = new JSONObject();
        digestless.put("schema", InstallRecord.SCHEMA);
        digestless.put("versionHash", HASH);
        writeFile(new File(dir, InstallRecord.FILE_NAME), digestless.toString().getBytes(StandardCharsets.UTF_8));
        try {
            InstallRecord.verifyForActivation(dir, HASH, bundle);
            fail("a digest-less record must not activate");
        } catch (IOException expected) {
            assertTrue(expected.getMessage().contains("completion record mismatch"));
        }

        // 旧版空标记仍然可信。
        writeFile(new File(dir, InstallRecord.FILE_NAME), new byte[0]);
        InstallRecord.verifyForActivation(dir, HASH, bundle);
    }

    @Test
    public void verifyForActivationRejectsMissingOrForeignRecords() throws Exception {
        File dir = temp.newFolder();
        File bundle = new File(dir, "index.bundlejs");
        writeFile(bundle, "x".getBytes(StandardCharsets.UTF_8));
        try {
            InstallRecord.verifyForActivation(dir, HASH, bundle);
            fail("missing record must not activate");
        } catch (IOException expected) {
            assertTrue(expected.getMessage().contains("incomplete"));
        }

        InstallRecord.write(dir, InstallRecord.build("anotherhash", DIGEST, ""));
        try {
            InstallRecord.verifyForActivation(dir, HASH, bundle);
            fail("record for another version must not activate");
        } catch (IOException expected) {
            assertTrue(expected.getMessage().contains("record mismatch"));
        }
    }

    @Test
    public void stagingDirectoryIsASibling() {
        File version = new File("/data/_update/" + HASH);
        assertEquals(new File("/data/_update/" + HASH + InstallRecord.STAGING_SUFFIX),
            InstallRecord.stagingDirectoryFor(version));
    }
}
