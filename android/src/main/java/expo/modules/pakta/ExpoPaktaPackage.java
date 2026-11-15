/**
 * [INPUT]: 依赖 Expo Package/ReactNativeHostHandler、RN 默认致命异常处理与共享 UpdateContext bundle 选择能力
 * [OUTPUT]: 对外提供 ExpoPaktaPackage，注册正式包热更 bundle 选择并保留致命异常传播的 HostHandler
 * [POS]: Expo Android 生命周期适配层；开发态交还 Metro，正式包复用 RN 异常链让原生崩溃救援可达，不复制下载、状态或回滚规则
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
package expo.modules.pakta;

import android.content.Context;
import androidx.annotation.Nullable;
import com.facebook.react.bridge.DefaultJSExceptionHandler;
import java.util.ArrayList;
import java.util.List;
import cn.reactnative.modules.update.UpdateContext;
import expo.modules.core.interfaces.Package;
import expo.modules.core.interfaces.ReactNativeHostHandler;

public class ExpoPaktaPackage implements Package {
    @Override
    public List<ReactNativeHostHandler> createReactNativeHostHandlers(Context context) {
        List<ReactNativeHostHandler> handlers = new ArrayList<>();
        handlers.add(new ReactNativeHostHandler() {
            @Nullable
            @Override
            public String getJSBundleFile(boolean useDeveloperSupport) {
                // 开发支持模式必须保留 Expo/Metro 的 bundle，不能加载旧热更。
                if (useDeveloperSupport) {
                    return null;
                }
                return UpdateContext.getBundleUrl(context);
            }

            // SDK 50 接口没有此回调，保留同名扩展方法兼容旧编译并覆写新版接口。
            public void onReactInstanceException(boolean useDeveloperSupport, Exception exception) {
                // Expo 有 HostHandler 时不再兜底重抛；正式包必须保留 RN 致命异常链。
                if (!useDeveloperSupport) {
                    new DefaultJSExceptionHandler().handleException(exception);
                }
            }
        });
        return handlers;
    }
}
