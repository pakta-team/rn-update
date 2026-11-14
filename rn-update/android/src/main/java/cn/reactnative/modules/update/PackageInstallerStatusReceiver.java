/**
 * [INPUT]: 依赖 Android BroadcastReceiver 生命周期与 manifest 注册的安装回执 Intent
 * [OUTPUT]: 把 PackageInstaller 会话状态广播转交给 ApkInstaller.handleStatus 归类
 * [POS]: Android APK 安装回执的入口 Receiver，无自身状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
package cn.reactnative.modules.update;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class PackageInstallerStatusReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        ApkInstaller.handleStatus(context, intent);
    }
}
