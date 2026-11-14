/**
 * [INPUT]: 依赖 junit4 与 CleanupKeepNames 纯函数
 * [OUTPUT]: 验证 keepnames 槽位填充、去重与三个互异版本时的延迟保护
 * [POS]: android/src/test 的 JVM 单元测试，守护清理 JNI 的版本名约束
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
package cn.reactnative.modules.update;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertNull;
import org.junit.Test;

public class CleanupKeepNamesTest {
    @Test
    public void fillsAvailableSlotsAndDeduplicates() {
        assertArrayEquals(new String[] {"current", "running"},
            CleanupKeepNames.select("current", null, "running"));
        assertArrayEquals(new String[] {"same", "running"},
            CleanupKeepNames.select("same", "same", "running"));
        assertArrayEquals(new String[] {"running", null},
            CleanupKeepNames.select(null, null, "running"));
    }

    @Test
    public void defersWhenThreeDistinctVersionsNeedProtection() {
        assertNull(CleanupKeepNames.select("current", "previous", "running"));
    }
}
