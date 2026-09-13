/**
 * [INPUT]: 依赖 junit4 与 UpdateFileUtils 的 isSafePathComponent
 * [OUTPUT]: 验证路径组件的接受域与分隔符/穿越/空组件拒绝
 * [POS]: android/src/test 的 JVM 单元测试，守护版本目录的路径安全
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
package cn.reactnative.modules.update;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class UpdateFileUtilsTest {
    @Test
    public void acceptsPlainComponents() {
        assertTrue(UpdateFileUtils.isSafePathComponent("0123abcdef"));
        assertTrue(UpdateFileUtils.isSafePathComponent("release-1.2.3_x.apk"));
        assertTrue(UpdateFileUtils.isSafePathComponent("..."));
        assertTrue(UpdateFileUtils.isSafePathComponent(".hidden"));
    }

    @Test
    public void rejectsEmptyAndDotComponents() {
        assertFalse(UpdateFileUtils.isSafePathComponent(null));
        assertFalse(UpdateFileUtils.isSafePathComponent(""));
        assertFalse(UpdateFileUtils.isSafePathComponent("."));
        assertFalse(UpdateFileUtils.isSafePathComponent(".."));
    }

    @Test
    public void rejectsSeparatorsAndTraversal() {
        assertFalse(UpdateFileUtils.isSafePathComponent("a/b"));
        assertFalse(UpdateFileUtils.isSafePathComponent("a\\b"));
        assertFalse(UpdateFileUtils.isSafePathComponent("../etc"));
        assertFalse(UpdateFileUtils.isSafePathComponent("/abs"));
        assertFalse(UpdateFileUtils.isSafePathComponent("hash/"));
        assertFalse(UpdateFileUtils.isSafePathComponent("a\0b"));
    }
}
