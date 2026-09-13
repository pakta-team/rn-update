/**
 * [INPUT]: 依赖 Detox 设备与 Debug 构建的首屏 testID
 * [OUTPUT]: 对外提供 React Native 首屏启动 smoke 断言
 * [POS]: e2e/smoke 的最小启动健康检查，不准备更新制品
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { by, device, element, waitFor } from 'detox';

// Debug 构建启动冒烟:只验证 app 能进首屏。codegen 生成的 Java spec 里
// 常量校验等检查包在 ReactBuildConfig.DEBUG 内,release e2e 全绿也拦不住
// (如 v10.48.2 修的 "Native Module Flow doesn't declare constants")。
// 首屏渲染前必须过 getConstants,崩了 bundle-label 永远不会出现。
// CI 上 metro 冷启动首次出 dev bundle 可能要几分钟,超时给足。
const BOOT_TIMEOUT = 300000;

describe('debug build boot smoke', () => {
  it('boots to the first screen', async () => {
    await device.launchApp({
      newInstance: true,
      ...(device.getPlatform() === 'android'
        ? { launchArgs: { detoxEnableSynchronization: '0' } }
        : {}),
    });

    await waitFor(element(by.id('bundle-label')))
      .toBeVisible()
      .withTimeout(BOOT_TIMEOUT);
  });
});
