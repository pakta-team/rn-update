/**
 * [INPUT]: 依赖实际 ExpoPaktaPackage、Expo HostHandler 与 JUnit，直接执行宿主异常回调
 * [OUTPUT]: 验证正式包保留原始致命异常/受检异常因果链，开发态保留宿主处理与 Metro
 * [POS]: Expo Android 适配器回归；只在 Expo 宿主编译，不模拟进程退出或原生救援成功
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
package cn.reactnative.modules.update;

import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.fail;

import expo.modules.core.interfaces.ReactNativeHostHandler;
import expo.modules.pakta.ExpoPaktaPackage;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import org.junit.Test;

public class ExpoHostExceptionTest {
    private ReactNativeHostHandler handler() {
        return new ExpoPaktaPackage().createReactNativeHostHandlers(null).get(0);
    }

    private void dispatch(boolean development, Exception error) throws Exception {
        ReactNativeHostHandler target = handler();
        // 旧 Expo 接口没有该方法，测试通过实际 handler 验证新增兼容入口。
        Method callback = target.getClass().getMethod(
            "onReactInstanceException", boolean.class, Exception.class);
        callback.setAccessible(true);
        try {
            callback.invoke(target, development, error);
        } catch (InvocationTargetException failure) {
            Throwable cause = failure.getCause();
            if (cause instanceof Exception) {
                throw (Exception) cause;
            }
            throw new AssertionError(cause);
        }
    }

    @Test
    public void releaseRethrowsOriginalRuntimeException() throws Exception {
        RuntimeException fatal = new RuntimeException("BRICK: crash on launch");
        try {
            dispatch(false, fatal);
            fail("正式包不得吞掉致命 JS 异常");
        } catch (RuntimeException actual) {
            assertSame(fatal, actual);
        }
    }

    @Test
    public void releasePreservesCheckedExceptionCause() throws Exception {
        Exception fatal = new Exception("native module failed");
        try {
            dispatch(false, fatal);
            fail("正式包不得吞掉受检异常");
        } catch (RuntimeException actual) {
            assertSame(fatal, actual.getCause());
        }
    }

    @Test
    public void developmentKeepsHostExceptionHandling() throws Exception {
        dispatch(true, new RuntimeException("development error"));
    }

    @Test
    public void developmentKeepsMetroBundleSelection() {
        assertNull(handler().getJSBundleFile(true));
    }
}
