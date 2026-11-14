/**
 * [INPUT]: 依赖 JUnit4、真实 ZIP/文件 IO 与 ContextWrapper 安装包路径替身，直接调用生产 copier 的双 map 接口
 * [OUTPUT]: 回归多目标与 split 来源复制、路径规范化、CRC 零值/内容寻址/漂移拒绝、map 只读及密度资格边界
 * [POS]: Android JVM 资源物化回归，不加载 JNI，不证明设备 Resources 密度解析
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
package cn.reactnative.modules.update;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import android.content.Context;
import android.content.ContextWrapper;
import android.content.pm.ApplicationInfo;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.zip.CRC32;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class BundledResourceCopierTest {
    @Rule
    public TemporaryFolder temp = new TemporaryFolder();

    private File apk(String path, byte[] bytes) throws IOException {
        File file = temp.newFile();
        try (ZipOutputStream out = new ZipOutputStream(new FileOutputStream(file))) {
            out.putNextEntry(new ZipEntry(path));
            out.write(bytes);
            out.closeEntry();
        }
        return file;
    }

    private BundledResourceCopier copier(final File base, final File... splits) {
        return new BundledResourceCopier(new ContextWrapper(null) {
            @Override
            public Context getApplicationContext() {
                return this;
            }

            @Override
            public String getPackageResourcePath() {
                return base.getAbsolutePath();
            }

            @Override
            public ApplicationInfo getApplicationInfo() {
                ApplicationInfo info = new ApplicationInfo();
                info.splitSourceDirs = new String[splits.length];
                for (int i = 0; i < splits.length; i++) {
                    info.splitSourceDirs[i] = splits[i].getAbsolutePath();
                }
                return info;
            }
        });
    }

    private static HashMap<String, ArrayList<File>> targets(String from, File... files) {
        HashMap<String, ArrayList<File>> result = new HashMap<>();
        result.put(from, new ArrayList<>(Arrays.asList(files)));
        return result;
    }

    private static HashMap<String, Long> crc(String from, byte[] bytes) {
        CRC32 crc = new CRC32();
        crc.update(bytes);
        HashMap<String, Long> result = new HashMap<>();
        result.put(from, crc.getValue());
        return result;
    }

    @Test
    public void copiesMultipleTargetsWithoutMutatingMaps() throws IOException {
        byte[] bytes = "resource".getBytes(StandardCharsets.UTF_8);
        File first = new File(temp.getRoot(), "first.png");
        File second = new File(temp.getRoot(), "second.png");
        HashMap<String, ArrayList<File>> files = targets("res/icon.png", first, second);
        HashMap<String, Long> crcs = crc("res/icon.png", bytes);
        HashMap<String, Long> originalCrcs = new HashMap<>(crcs);
        copier(apk("res/icon.png", bytes)).copyFromResource(files, crcs);
        assertArrayEquals(bytes, Files.readAllBytes(first.toPath()));
        assertArrayEquals(bytes, Files.readAllBytes(second.toPath()));
        assertEquals(Arrays.asList(first, second), files.get("res/icon.png"));
        assertEquals(1, files.size());
        assertEquals(originalCrcs, crcs);
    }

    @Test
    public void copiesNormalizedPathWithoutCrc() throws IOException {
        byte[] bytes = {1, 2, 3};
        File target = new File(temp.getRoot(), "normalized.png");
        copier(apk("res/drawable/icon.png", bytes)).copyFromResource(
            targets("base/res/drawable-v24/icon.png", target), new HashMap<String, Long>());
        assertArrayEquals(bytes, Files.readAllBytes(target.toPath()));
    }

    @Test
    public void findsRenamedContentInSplitWithDuplicateBasePath() throws IOException {
        byte[] bytes = {4, 5, 6};
        File target = new File(temp.getRoot(), "split.png");
        copier(apk("res/a.png", new byte[] {9}), apk("res/a.png", bytes))
            .copyFromResource(targets("res/a.png", target), crc("res/a.png", bytes));
        assertArrayEquals(bytes, Files.readAllBytes(target.toPath()));
    }

    @Test
    public void acceptsZeroCrcForRenamedEmptyResource() throws IOException {
        File target = new File(temp.getRoot(), "empty.png");
        copier(apk("res/short.png", new byte[0])).copyFromResource(
            targets("res/original.png", target), crc("res/original.png", new byte[0]));
        assertTrue(target.isFile());
        assertEquals(0, target.length());
    }

    @Test
    public void rejectsDriftWithoutWritingOrMutatingMaps() throws IOException {
        File target = new File(temp.getRoot(), "rejected.png");
        HashMap<String, ArrayList<File>> files = targets("res/icon.png", target);
        HashMap<String, Long> crcs = crc("res/icon.png", new byte[] {1});
        try {
            copier(apk("res/icon.png", new byte[] {2})).copyFromResource(files, crcs);
            fail("content drift must fail");
        } catch (IOException expected) {
            assertTrue(expected.getMessage().contains("content mismatch (crc32)"));
        }
        assertFalse(target.exists());
        assertEquals(Collections.singletonList(target), files.get("res/icon.png"));
        assertEquals(crc("res/icon.png", new byte[] {1}), crcs);
    }

    @Test
    public void rejectsLocatedResourceWriteFailure() throws IOException {
        File target = temp.newFolder();
        try {
            copier(apk("res/icon.png", new byte[] {1})).copyFromResource(
                targets("res/icon.png", target), new HashMap<String, Long>());
            fail("write failure must fail");
        } catch (IOException expected) {
            assertTrue(expected.getMessage().contains("Failed to copy"));
        }
    }

    @Test
    public void densitySubstitutionOnlyAcceptsMissingPlainDrawableDensity() {
        HashSet<String> installed = BundledResourceCopier.installedSplitDensities(
            new ArrayList<>(Arrays.asList("/base.apk", "/split_config.xxhdpi.apk")));
        assertEquals(Collections.singleton("xxhdpi"), installed);
        assertTrue(BundledResourceCopier.canSubstituteDensityVariant(
            new String[] {"drawable-hdpi/icon.png", "drawable-xhdpi/icon.png"}, installed));
        for (String path : Arrays.asList("drawable-xxhdpi/icon.png",
            "drawable-night-hdpi/icon.png", "raw/icon.png", "assets/icon.png")) {
            assertFalse(BundledResourceCopier.canSubstituteDensityVariant(
                new String[] {path}, installed));
        }
        assertFalse(BundledResourceCopier.canSubstituteDensityVariant(
            new String[] {"drawable-hdpi/icon.png"}, new HashSet<String>()));
    }
}
