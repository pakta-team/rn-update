/**
 * [INPUT]: 依赖 Expo Package/ReactNativeHostHandler、Android Context 与共享 UpdateContext bundle 选择能力
 * [OUTPUT]: 对外提供 ExpoPaktaPackage，为 Expo 宿主注册返回当前热更 bundle 的 HostHandler
 * [POS]: Expo Android 生命周期适配层，只桥接宿主 bundle 文件选择，不复制下载、状态或回滚规则
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

public class ExpoPaktaPackage  implements Package {
    @Override
    public List<ReactNativeHostHandler> createReactNativeHostHandlers(Context context) {
        List<ReactNativeHostHandler> handlers = new ArrayList<>();
        handlers.add(new ReactNativeHostHandler() {
            @Nullable
            @Override
            public String getJSBundleFile(boolean useDeveloperSupport) {
                return UpdateContext.getBundleUrl(context);
            }
        });
        return handlers;
    }
}
