/**
 * [INPUT]: 依赖 Hypium、abilityDelegatorRegistry 与 EntryAbility bundle 标识。
 * [OUTPUT]: 导出 abilityTest，启动 Ability 并断言当前上下文与 filesDir 有效。
 * [POS]: Harmony 设备 smoke 测试，验证 RNOH 宿主在更新集成前能稳定启动。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { describe, beforeAll, it, expect } from '@ohos/hypium';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { abilityDelegatorRegistry } from '@kit.TestKit';

const TAG = 'AbilityTest';
const delegator = abilityDelegatorRegistry.getAbilityDelegator();

export default function abilityTest() {
  describe('AbilityLaunchTest', () => {
    beforeAll(async () => {
      hilog.info(0x0000, TAG, 'AbilityLaunchTest beforeAll');
      const want = {
        bundleName: 'com.example.harmony_use_pakta',
        abilityName: 'EntryAbility',
      };
      await delegator.startAbility(want);
      // Allow the RN surface time to initialize
      await new Promise<void>(resolve => setTimeout(resolve, 3000));
    });

    it('ability should launch successfully', 0, async () => {
      hilog.info(0x0000, TAG, 'checking ability launch');
      const currentAbility = delegator.getCurrentTopAbility();
      expect(currentAbility).assertNotNull();
      hilog.info(0x0000, TAG, 'ability launched: %{public}s', JSON.stringify(currentAbility.context?.abilityInfo?.name));
    });

    it('ability context should have valid filesDir', 0, async () => {
      const currentAbility = delegator.getCurrentTopAbility();
      const context = currentAbility.context;
      expect(context).assertNotNull();
      expect(context.filesDir).assertContain('/files');
      hilog.info(0x0000, TAG, 'filesDir: %{public}s', context.filesDir);
    });
  });
}
