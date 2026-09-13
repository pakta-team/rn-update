/**
 * [INPUT]: 依赖 ReactHost 默认构造器、自动链接包列表与 rn-update 的 UpdateContext。
 * [OUTPUT]: 提供 Application 生命周期，并把当前热更新 bundle URL 注入 ReactHost。
 * [POS]: Android 原生 bundle 选择根；JS 页面与更新协议均通过此入口获得当前文件。
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
