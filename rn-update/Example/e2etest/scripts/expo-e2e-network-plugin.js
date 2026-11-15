/**
 * [INPUT]: 依赖宿主 Expo Config Plugin 的 Manifest 与 dangerous mod 扩展点
 * [OUTPUT]: 提供仅允许 Android 模拟器 10.0.2.2 明文请求的测试网络插件
 * [POS]: Expo 隔离宿主的生成模板；不修改 SDK 或生产示例，重复 prebuild 保持相同网络边界
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const fs = require('node:fs');
const path = require('node:path');
const {
  withAndroidManifest,
  withDangerousMod,
} = require('expo/config-plugins');

const NETWORK_POLICY = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">10.0.2.2</domain>
  </domain-config>
</network-security-config>
`;

function withE2eNetwork(config) {
  config = withAndroidManifest(config, (mod) => {
    const application = mod.modResults.manifest.application?.[0];
    if (!application?.$) throw new Error('Expo Android application is missing');
    const current = application.$['android:networkSecurityConfig'];
    if (current && current !== '@xml/network_security_config')
      throw new Error('Refusing to replace an existing Android network policy');
    application.$['android:usesCleartextTraffic'] = 'false';
    application.$['android:networkSecurityConfig'] =
      '@xml/network_security_config';
    return mod;
  });
  return withDangerousMod(config, [
    'android',
    (mod) => {
      const directory = path.join(
        mod.modRequest.platformProjectRoot,
        'app/src/main/res/xml'
      );
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(
        path.join(directory, 'network_security_config.xml'),
        NETWORK_POLICY
      );
      return mod;
    },
  ]);
}

module.exports = withE2eNetwork;
module.exports.NETWORK_POLICY = NETWORK_POLICY;
