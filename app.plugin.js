/**
 * [INPUT]: 依赖 @expo/config-plugins 的 withInfoPlist/withAndroidManifest（由 rn-update 运行时依赖保证可解析）
 * [OUTPUT]: 对外提供 Expo Config Plugin 入口 withRnUpdate，把 channel 固化进 iOS Info.plist 与 Android Manifest meta-data
 * [POS]: rn-update 包根的 Expo prebuild 入口，与 expo-module.config.json 共同构成 Expo 原生接入面；appKey/server 等运行时配置仍由 JS 侧 Pakta 客户端独占
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

const { withAndroidManifest, withInfoPlist } = require('@expo/config-plugins');

function withRnUpdate(config, props = {}) {
  const raw = props.channel;
  if (raw === undefined || raw === null) {
    return config;
  }
  if (typeof raw !== 'string') {
    throw new Error(
      `[rn-update] "channel" must be a string, received ${typeof raw}`
    );
  }
  const channel = raw.trim();
  if (channel.length === 0) {
    throw new Error('[rn-update] "channel" must not be empty');
  }

  const withChannel = withInfoPlist(config, (mod) => {
    mod.modResults.channel = channel;
    return mod;
  });

  return withAndroidManifest(withChannel, (mod) => {
    const application = mod.modResults.manifest.application?.[0];
    if (!application) {
      throw new Error(
        '[rn-update] AndroidManifest.xml has no <application> node'
      );
    }
    const others = (application['meta-data'] || []).filter(
      (item) => item?.$?.['android:name'] !== 'channel'
    );
    application['meta-data'] = [
      ...others,
      { $: { 'android:name': 'channel', 'android:value': channel } },
    ];
    return mod;
  });
}

module.exports = withRnUpdate;
