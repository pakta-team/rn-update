/**
 * [INPUT]: 依赖 ReactActivity、DefaultReactActivityDelegate 与宿主 BuildConfig
 * [OUTPUT]: 对外提供 RN Android 主 Activity 生命周期与 delegate
 * [POS]: e2etest Android 宿主入口，更新能力由自动链接 SDK 注入
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
package com.awesomeproject

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "AwesomeProject"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
