/**
 * [INPUT]: 依赖 ../../app.plugin.js 的 Expo Config Plugin 入口，依赖 @expo/config-plugins 的 mod 组合机制与 bun:test
 * [OUTPUT]: 提供插件配置面契约回归：channel 写入双端原生身份、无 channel 不动配置、非法值抛错与幂等重写
 * [POS]: __tests__ 的 Expo prebuild 边界单测，锁定 channel 是唯一原生注入面，不触 JS 侧 ClientOptions 语义
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { describe, expect, test } from 'bun:test';

const withRnUpdate = require('../../app.plugin.js') as (
  config: unknown,
  props?: { channel?: unknown }
) => any;

const baseConfig = () => ({ _internal: {}, mods: {} });

const manifestWith = (metaData: unknown[]) => ({
  manifest: { application: [{ 'meta-data': metaData }] },
});

describe('app.plugin', () => {
  test('writes channel into iOS Info.plist modResults with trim', async () => {
    const config = withRnUpdate(baseConfig(), { channel: ' staging ' });
    const ios = await config.mods.ios.infoPlist({ modResults: {} });
    expect(ios.modResults.channel).toBe('staging');
  });

  test('replaces stale channel meta-data and keeps others idempotently', async () => {
    const config = withRnUpdate(baseConfig(), { channel: 'huawei' });
    const android = await config.mods.android.manifest({
      modResults: manifestWith([
        { $: { 'android:name': 'channel', 'android:value': 'old' } },
        { $: { 'android:name': 'other', 'android:value': 'keep' } },
      ]),
    });
    expect(android.modResults.manifest.application[0]['meta-data']).toEqual([
      { $: { 'android:name': 'other', 'android:value': 'keep' } },
      { $: { 'android:name': 'channel', 'android:value': 'huawei' } },
    ]);
  });

  test('appends channel meta-data when manifest has none', async () => {
    const config = withRnUpdate(baseConfig(), { channel: 'xiaomi' });
    const android = await config.mods.android.manifest({
      modResults: { manifest: { application: [{}] } },
    });
    expect(android.modResults.manifest.application[0]['meta-data']).toEqual([
      { $: { 'android:name': 'channel', 'android:value': 'xiaomi' } },
    ]);
  });

  test('returns config untouched when channel is absent', () => {
    const input = baseConfig();
    expect(withRnUpdate(input)).toBe(input);
    expect(withRnUpdate(input, {})).toBe(input);
    expect(withRnUpdate(input, { channel: undefined })).toBe(input);
  });

  test('throws on invalid channel values', () => {
    const input = baseConfig();
    expect(() => withRnUpdate(input, { channel: 1 })).toThrow(
      '[rn-update] "channel" must be a string, received number'
    );
    expect(() => withRnUpdate(input, { channel: '  ' })).toThrow(
      '[rn-update] "channel" must not be empty'
    );
  });
});
