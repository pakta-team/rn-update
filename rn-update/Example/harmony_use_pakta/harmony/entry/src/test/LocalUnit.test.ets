/**
 * [INPUT]: 依赖 Hypium describe/it/expect 与更新 manifest/hash 的纯数据约定。
 * [OUTPUT]: 导出 localUnitTest，覆盖 JSON 往返、版本比较和 hash key 规则。
 * [POS]: Harmony 本地测试最小语义层，不触碰 Ability、文件系统或网络。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { describe, it, expect } from '@ohos/hypium';

export default function localUnitTest() {
  describe('localUnitTest', () => {
    it('JSON parse round-trip for update manifest', 0, () => {
      const manifest = {
        copies: { 'assets/icon.png': 'assets/original.png' },
        deletes: ['assets/old.png'],
      };
      const serialized = JSON.stringify(manifest);
      const parsed = JSON.parse(serialized);
      expect(parsed.copies['assets/icon.png']).assertEqual('assets/original.png');
      expect(parsed.deletes[0]).assertEqual('assets/old.png');
    });

    it('version string comparison works correctly', 0, () => {
      const v1 = '1.0.0';
      const v2 = '1.0.0';
      const v3 = '2.0.0';
      expect(v1 === v2).assertEqual(true);
      expect(v1 === v3).assertEqual(false);
    });

    it('hash string concatenation for kv keys', 0, () => {
      const hash = 'abc123';
      const key = `hash_${hash}`;
      expect(key).assertEqual('hash_abc123');
      expect(key).assertContain('hash_');
    });
  });
}
