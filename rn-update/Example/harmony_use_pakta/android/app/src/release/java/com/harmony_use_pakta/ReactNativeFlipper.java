/**
 * [INPUT]: 依赖 ReactInstanceManager 类型以保持与 debug 变体相同的调用签名。
 * [OUTPUT]: 提供 release 变体的空 initializeFlipper 实现。
 * [POS]: Android release 链接兼容层，避免把 Flipper 依赖带入发布包。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * <p>This source code is licensed under the MIT license found in the LICENSE file in the root
 * directory of this source tree.
 */
package com.harmony_use_pakta;

import android.content.Context;
import com.facebook.react.ReactInstanceManager;

/**
 * Class responsible of loading Flipper inside your React Native application. This is the release
 * flavor of it so it's empty as we don't want to load Flipper.
 */
public class ReactNativeFlipper {
  public static void initializeFlipper(Context context, ReactInstanceManager reactInstanceManager) {
    // Do nothing as we don't want to initialize Flipper on Release.
  }
}
