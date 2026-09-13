/**
 * [INPUT]: 依赖 Hypium、Ability context、preferences 与 Harmony 文件系统 API。
 * [OUTPUT]: 导出 paktaIntegrationTest，验证偏好、更新目录和 hash 元数据可读写。
 * [POS]: Harmony Pakta 存储边界集成测试，覆盖 SDK 原生持久化所需的宿主能力。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { describe, beforeAll, it, expect } from '@ohos/hypium';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { abilityDelegatorRegistry } from '@kit.TestKit';
import preferences from '@ohos.data.preferences';

const TAG = 'PaktaIntegrationTest';
const delegator = abilityDelegatorRegistry.getAbilityDelegator();

export default function paktaIntegrationTest() {
  describe('PaktaIntegrationTest', () => {
    let context: Context;

    beforeAll(async () => {
      hilog.info(0x0000, TAG, 'PaktaIntegrationTest beforeAll');
      const want = {
        bundleName: 'com.example.harmony_use_pakta',
        abilityName: 'EntryAbility',
      };
      await delegator.startAbility(want);
      await new Promise<void>(resolve => setTimeout(resolve, 3000));
      const ability = delegator.getCurrentTopAbility();
      context = ability.context;
    });

    it('update preferences should be writable and readable', 0, async () => {
      hilog.info(0x0000, TAG, 'testing preferences read/write');
      const prefs = preferences.getPreferencesSync(context, {
        name: 'pakta_integration_test',
      });

      prefs.putSync('testKey', 'testValue');
      prefs.flush();

      const value = prefs.getSync('testKey', '') as string;
      expect(value).assertEqual('testValue');

      // Clean up
      prefs.deleteSync('testKey');
      prefs.flush();
      hilog.info(0x0000, TAG, 'preferences test passed');
    });

    it('update root directory should be creatable', 0, async () => {
      hilog.info(0x0000, TAG, 'testing update root directory');
      const updateRoot = context.filesDir + '/_update_test';
      const fileIo = await import('@ohos.file.fs');

      // Ensure clean state
      try {
        if (fileIo.default.accessSync(updateRoot)) {
          fileIo.default.rmdirSync(updateRoot);
        }
      } catch {}

      fileIo.default.mkdirSync(updateRoot);
      const exists = fileIo.default.accessSync(updateRoot);
      expect(exists).assertTrue();

      // Clean up
      fileIo.default.rmdirSync(updateRoot);
      hilog.info(0x0000, TAG, 'update root directory test passed');
    });

    it('hash info round-trip through preferences', 0, async () => {
      hilog.info(0x0000, TAG, 'testing hash info round-trip');
      const prefs = preferences.getPreferencesSync(context, {
        name: 'pakta_integration_test',
      });

      const hashInfo = JSON.stringify({ name: 'v1', description: 'test version' });
      const key = 'hash_test123';

      prefs.putSync(key, hashInfo);
      prefs.flush();

      const retrieved = prefs.getSync(key, '') as string;
      expect(retrieved).assertEqual(hashInfo);

      const parsed = JSON.parse(retrieved);
      expect(parsed.name).assertEqual('v1');
      expect(parsed.description).assertEqual('test version');

      // Clean up
      prefs.deleteSync(key);
      prefs.flush();
      hilog.info(0x0000, TAG, 'hash info round-trip test passed');
    });

    it('initial state should have no current version', 0, async () => {
      hilog.info(0x0000, TAG, 'testing initial state');
      const prefs = preferences.getPreferencesSync(context, {
        name: 'pakta_initial_state_test',
      });

      const currentVersion = prefs.getSync('currentVersion', '') as string;
      expect(currentVersion).assertEqual('');

      const firstTime = prefs.getSync('firstTime', false) as boolean;
      expect(firstTime).assertEqual(false);

      // Clean up
      preferences.deletePreferences(context, { name: 'pakta_initial_state_test' });
      hilog.info(0x0000, TAG, 'initial state test passed');
    });
  });
}
