/**
 * [INPUT]: 依赖 Expo Package/ReactNativeHostHandler、Android Context 与共享 UpdateContext bundle 选择能力
 * [OUTPUT]: 对外提供 ExpoPaktaPackage，为 Expo 宿主注册正式包热更 bundle 的 HostHandler
 * [POS]: Expo Android 生命周期适配层；开发支持模式交还 Metro，正式包才桥接热更 bundle 文件选择，不复制下载、状态或回滚规则
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
package expo.modules.pakta;

import android.content.Context;
import androidx.annotation.Nullable;
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
        });
        return handlers;
    }
}
