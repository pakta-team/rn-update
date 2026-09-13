/**
 * [INPUT]: 依赖 TurboReactPackage、ReactModuleInfo、BuildConfig 架构标志与 UpdateModule
 * [OUTPUT]: 对外提供 UpdatePackage，按模块名构造 Pakta 原生模块并声明 Codegen/TurboModule 元数据
 * [POS]: Android React Native 自动链接注册入口，只负责发现与实例化，不执行更新用例
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
package cn.reactnative.modules.update;

import androidx.annotation.Nullable;
import com.facebook.react.TurboReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.module.model.ReactModuleInfo;
import com.facebook.react.module.model.ReactModuleInfoProvider;
import java.util.HashMap;
import java.util.Map;

// TurboReactPackage and the 7-argument ReactModuleInfo are deprecated in
// current React Native but still shipped; their replacements
// (BaseReactPackage, the 6-argument constructor) only exist from RN 0.74,
// and this module's peer floor is RN 0.59.
@SuppressWarnings("deprecation")
public class UpdatePackage extends TurboReactPackage {
    @Nullable
    @Override
    public NativeModule getModule(String name, ReactApplicationContext reactContext) {
        return name.equals(UpdateModuleImpl.NAME) ? new UpdateModule(reactContext) : null;
    }

    @Override
    public ReactModuleInfoProvider getReactModuleInfoProvider() {
        return new ReactModuleInfoProvider() {
            @Override
            public Map<String, ReactModuleInfo> getReactModuleInfos() {
                final Map<String, ReactModuleInfo> moduleInfos = new HashMap<>();
                boolean isTurboModule = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED;
                moduleInfos.put(
                        UpdateModuleImpl.NAME,
                        new ReactModuleInfo(
                                UpdateModuleImpl.NAME,
                                UpdateModuleImpl.NAME,
                                false, // canOverrideExistingModule
                                false, // needsEagerInit
                                true, // hasConstants
                                false, // isCxxModule
                                isTurboModule // isTurboModule
                        ));
                return moduleInfos;
            }
        };
    }
}
