/**
 * [INPUT]: 依赖 CLI 全局常量模块与 Bun 测试断言
 * [OUTPUT]: 验证 API 服务地址、前端价格页地址、品牌标识和 PPK 文件名契约
 * [POS]: constants 回归测试，阻止服务域名、价格页域名或 CLI 身份漂移
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { describe, expect, it } from 'bun:test';

describe('constants', () => {
  it('initializes the single Pakta CLI identity', async () => {
    const mod = await import('../src/utils/constants.ts');
    expect(mod.scriptName).toBe('pakta');
    expect(mod.credentialFile).toBe('.pakta.token');
    expect(mod.updateJson).toBe('update.json');
    expect(mod.tempDir).toBe('.pakta');
    expect(mod.frontendBaseUrl).toBe('https://pakta.site');
    expect(mod.pricingPageUrl).toBe('https://pakta.site/pricing');
    expect(mod.currentServiceUrl).toBe('https://pakta.yoghourt.space');
    expect(mod.defaultEndpoints).toEqual(['https://pakta.yoghourt.space']);
  });

  it('should identify PPK bundle file names correctly', async () => {
    const { isPPKBundleFileName } = await import('../src/utils/constants.ts');
    expect(isPPKBundleFileName('index.bundlejs')).toBe(true);
    expect(isPPKBundleFileName('bundle.harmony.js')).toBe(true);
    expect(isPPKBundleFileName('index.js')).toBe(false);
    expect(isPPKBundleFileName('main.bundlejs')).toBe(false);
  });
});
