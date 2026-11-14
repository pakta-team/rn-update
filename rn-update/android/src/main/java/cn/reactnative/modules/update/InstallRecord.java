/**
 * [INPUT]: 依赖 org.json、java.io/nio 与 Android API 分级能力；schema/记录名/staging 后缀由 scripts/contract.json 的 installRecord 派生，IO 与摘要校验不参与生成
 * [OUTPUT]: 提供 .pakta-complete 完成记录的构建/写入(fsync+目录 sync)/解析/校验与 staging 目录工具
 * [POS]: Android 的安装完整性层，原子 rename 前落记录、激活前重验 bundle 摘要
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
package cn.reactnative.modules.update;

import java.io.File;
import java.io.IOException;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Java mirror of cpp/patch_core/install_record.h — keep in sync by hand.
 * The completion record written as the last step of a two-phase install and
 * read back before a version directory is trusted.
 */
final class InstallRecord {
    static final int SCHEMA = 1;
    static final String FILE_NAME = ".pakta-complete";
    static final String STAGING_SUFFIX = ".staging";

    private InstallRecord() {
    }

    static File stagingDirectoryFor(File versionDir) {
        return new File(versionDir.getPath() + STAGING_SUFFIX);
    }

    /**
     * bundleSha256 is mandatory for schema 1: a version whose bundle could
     * not be hashed must fail its install, never be recorded unverifiable.
     */
    static String build(String versionHash, String bundleSha256, String artifactSha256)
        throws IOException, JSONException {
        return NativeInstall.execute("build", versionHash, bundleSha256, artifactSha256, null);
    }

    /**
     * Writes the record and fsyncs it, then the directory holding it: the
     * rename that follows must find the record on disk, and the new
     * directory entry is only durable once the directory itself is synced.
     */
    static void write(File versionDir, String recordJson) throws IOException {
        NativeInstall.execute("write", versionDir.getAbsolutePath(), recordJson, null, null);
    }

    /**
     * Parsed record, or null when the file is absent or malformed. An empty
     * file (legacy marker) yields an empty JSONObject.
     */
    static JSONObject read(File versionDir) {
        try {
            String text = NativeInstall.execute("read", versionDir.getAbsolutePath(), null, null, null);
            return text == null ? null : new JSONObject(text);
        } catch (IOException | JSONException e) {
            return null;
        }
    }

    /**
     * Presence check: the record exists and, unless legacy-empty, names this
     * version. No digest work — this runs on launch / dedup paths.
     */
    static boolean isComplete(File versionDir, String versionHash) {
        try {
            return "true".equals(NativeInstall.execute("complete", versionDir.getAbsolutePath(),
                versionHash, null, null));
        } catch (IOException e) {
            return false;
        }
    }

    /**
     * Activation check: re-hashes the bundle against the record's digest,
     * which schema 1 makes mandatory (only the legacy empty marker has none).
     * Throws with the reason when the directory must not be activated.
     */
    static void verifyForActivation(File versionDir, String versionHash, File bundleFile)
        throws IOException {
        try (Activation snapshot = checkActivation(versionDir, versionHash, bundleFile, false)) {
            snapshot.assertUnchanged(false);
        }
    }

    static Activation checkActivation(File directory, String hash, File bundle, boolean grandfathered)
        throws IOException {
        if (!bundle.getCanonicalFile().getParentFile().equals(directory.getCanonicalFile())) {
            throw new IOException("Bundle is outside version directory");
        }
        return new Activation(NativeInstall.checkActivation(directory.getAbsolutePath(), hash,
            bundle.getName(), grandfathered));
    }

    static void seal(File staging, String hash, String artifact) throws IOException {
        NativeInstall.execute("seal", staging.getAbsolutePath(), hash, artifact, null);
    }

    static void promote(File staging, File directory) throws IOException {
        NativeInstall.execute("promote", staging.getAbsolutePath(), directory.getAbsolutePath(), null, null);
    }

    static final class Activation implements AutoCloseable {
        private long handle;

        private Activation(long handle) throws IOException {
            if (handle == 0) throw new IOException("Missing activation snapshot");
            this.handle = handle;
        }

        synchronized void assertUnchanged(boolean grandfathered) throws IOException {
            if (handle == 0 || !NativeInstall.unchanged(handle, grandfathered)) {
                throw new IOException("Install changed before activation commit");
            }
        }

        @Override
        public synchronized void close() {
            if (handle != 0) {
                NativeInstall.release(handle);
                handle = 0;
            }
        }
    }
}
