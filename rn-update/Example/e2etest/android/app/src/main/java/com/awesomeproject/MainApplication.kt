/**
 * [INPUT]: 依赖 Application、ReactNativeHost、PackageList 与新架构配置
 * [OUTPUT]: 对外提供 RN Android 应用实例、包列表和 host 生命周期
 * [POS]: e2etest Android 宿主组合根，不复制更新状态规则
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
package com.awesomeproject

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import cn.reactnative.modules.update.UpdateContext

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be auto-linked yet can be added manually here, for example:
          // add(MyReactNativePackage())
        },
      jsBundleFilePath = UpdateContext.getBundleUrl(this),
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
