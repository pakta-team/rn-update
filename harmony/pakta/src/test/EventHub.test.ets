/**
 * [INPUT]: 依赖 @ohos/hypium、EventHub 单例与受控 RNInstance 替身
 * [OUTPUT]: 提供事件单例、无实例安全降级、emitDeviceEvent 投影和 clearRNInstance 回归断言
 * [POS]: pakta 测试层的事件边界验证，不参与生产运行时
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { describe, it, expect } from '@ohos/hypium';
import { EventHub } from '../main/ets/EventHub';

export default function eventHubTest() {
  describe('EventHub', () => {
    it('is a singleton', 0, () => {
      const a = EventHub.getInstance();
      const b = EventHub.getInstance();
      expect(a === b).assertEqual(true);
    });

    it('does not throw when emitting without rnInstance', 0, () => {
      const hub = EventHub.getInstance();
      hub.setRNInstance(undefined);
      let threw = false;
      try {
        hub.emit('test', { foo: 'bar' });
      } catch {
        threw = true;
      }
      expect(threw).assertEqual(false);
    });

    it('calls emitDeviceEvent on rnInstance when set', 0, () => {
      const hub = EventHub.getInstance();
      let capturedEvent = '';
      let capturedData: Record<string, number> = {};
      const mockRnInstance = {
        emitDeviceEvent(event: string, data: Object) {
          capturedEvent = event;
          capturedData = data as Record<string, number>;
        },
      };
      hub.setRNInstance(mockRnInstance);
      hub.emit('RCTPaktaDownloadProgress', { received: 100, total: 200 });
      expect(capturedEvent).assertEqual('RCTPaktaDownloadProgress');
      expect(capturedData.received).assertEqual(100);
      expect(capturedData.total).assertEqual(200);
      hub.setRNInstance(undefined);
    });

    it('clearRNInstance only drops the instance it is given', 0, () => {
      const hub = EventHub.getInstance();
      let calls = 0;
      const current = { emitDeviceEvent(_event: string, _data: Object) { calls++; } };
      const stale = { emitDeviceEvent(_event: string, _data: Object) { calls++; } };
      hub.setRNInstance(current);
      hub.clearRNInstance(stale);
      hub.emit('RCTPaktaDownloadProgress', { received: 1, total: 2 });
      expect(calls).assertEqual(1);
      hub.clearRNInstance(current);
      hub.emit('RCTPaktaDownloadProgress', { received: 2, total: 2 });
      expect(calls).assertEqual(1);
    });
  });
}
