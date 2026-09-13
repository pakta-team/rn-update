/**
 * [INPUT]: 依赖 ReactActivity、默认新架构 delegate 与 AwesomeProject JS 根组件名。
 * [OUTPUT]: 提供 RN Activity，并在新架构下创建默认 ReactActivityDelegate。
 * [POS]: Android 宿主生命周期薄适配层，不直接处理更新状态。
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
