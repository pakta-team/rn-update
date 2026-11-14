/**
 * [INPUT]: 依赖 ReactActivity 与默认新架构 delegate。
 * [OUTPUT]: 提供 harmony_use_pakta RN Activity，并返回 JS 主组件名。
 * [POS]: Android 消费端薄宿主，不直接参与 Harmony 更新状态管理。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
package com.harmony_use_pakta;

import com.facebook.react.ReactActivity;
import com.facebook.react.ReactActivityDelegate;
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint;
import com.facebook.react.defaults.DefaultReactActivityDelegate;

public class MainActivity extends ReactActivity {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  @Override
  protected String getMainComponentName() {
    return "harmony_use_pakta";
  }

  /**
   * Returns the instance of the {@link ReactActivityDelegate}. Here we use a util class {@link
   * DefaultReactActivityDelegate} which allows you to easily enable Fabric and Concurrent React
   * (aka React 18) with two boolean flags.
   */
  @Override
  protected ReactActivityDelegate createReactActivityDelegate() {
    return new DefaultReactActivityDelegate(
        this,
        getMainComponentName(),
        // If you opted-in for the New Architecture, we enable the Fabric Renderer.
        DefaultNewArchitectureEntryPoint.getFabricEnabled());
  }
}
