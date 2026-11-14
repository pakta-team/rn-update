package cn.reactnative.modules.update;

import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.io.IOException;
import org.junit.Test;

public class SharedInstallBoundaryTest {
    @org.junit.BeforeClass public static void requireNative() {
        SharedInstallNativeTest.requireNative();
    }

    @Test
    public void rejectsShortDigest() throws Exception {
        try {
            InstallRecord.build("version", "bb", "");
            fail("short digest accepted");
        } catch (IOException expected) {
            assertTrue(expected.getMessage().contains("digest"));
        }
    }

    @Test
    public void reservedAncestorCannotHideBehindOrdinaryLeaf() {
        assertTrue(SafeZipFile.isReservedEntryName("assets/.pakta-private/image.png"));
        assertTrue(SafeZipFile.isReservedEntryName("assets\\.pakta-private\\image.png"));
    }
}
