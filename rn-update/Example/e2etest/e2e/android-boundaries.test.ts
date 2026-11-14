/**
 * [INPUT]: 依赖 Android Detox Release 应用、本地服务与真实差分制品；临时损坏已备份的补丁后以 finally 恢复
 * [OUTPUT]: 提供损坏/缺失差分拒绝、已确认版本保持与重启后状态安全的真实设备回归
 * [POS]: E2E 失败边界叶节点；服务端禁 full fallback，因此不能靠全量包掩盖补丁失败，不模拟 SDK 决策
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { by, device, element, waitFor } from 'detox';
import {
  LOCAL_UPDATE_FILES,
  LOCAL_UPDATE_HASHES,
  LOCAL_UPDATE_LABELS,
  LOCAL_UPDATE_PORT,
} from './localUpdateConfig.ts';

const android =
  process.env.E2E_PLATFORM === 'android' ? describe : describe.skip;
const patchPath = path.resolve(
  '.e2e-artifacts/android',
  LOCAL_UPDATE_FILES.ppkDiff
);
let patch: Buffer;

function launchOptions() {
  return { newInstance: true, launchArgs: { detoxEnableSynchronization: '0' } };
}

async function label(value: string) {
  await waitFor(element(by.id('bundle-label')))
    .toHaveText(`bundleLabel: ${value}`)
    .withTimeout(120000);
}

async function currentHash(value: string) {
  await waitFor(element(by.id('current-hash')))
    .toHaveText(`currentHash: ${value || '(empty)'}`)
    .withTimeout(30000);
}

android('Android download failure boundaries', () => {
  beforeAll(async () => {
    patch = readFileSync(patchPath);
    const manifest = JSON.parse(
      readFileSync(path.resolve('.e2e-artifacts/android/manifest.json'), 'utf8')
    );
    expect(manifest.fullFallback).toBe(false);
    await device.launchApp({ ...launchOptions(), delete: true });
  });

  beforeEach(async () => {
    writeFileSync(patchPath, patch);
    await device.launchApp(launchOptions());
    await device.setURLBlacklist([`.*:${LOCAL_UPDATE_PORT}.*`]);
    await waitFor(element(by.id('reset-to-packaged')))
      .toBeVisible()
      .withTimeout(30000);
    await element(by.id('reset-to-packaged')).tap();
    await waitFor(element(by.id('last-event')))
      .toHaveText('lastEvent: resetDone')
      .withTimeout(15000);
    await device.launchApp(launchOptions());
    await device.setURLBlacklist([`.*:${LOCAL_UPDATE_PORT}.*`]);
    await label(LOCAL_UPDATE_LABELS.base);
    await currentHash('');
    await element(by.id('check-update')).tap();
    await label(LOCAL_UPDATE_LABELS.full);
    await currentHash(LOCAL_UPDATE_HASHES.full);
    await waitFor(element(by.id('last-event')))
      .toHaveText('lastEvent: markSuccess')
      .withTimeout(30000);
  });

  afterEach(() => {
    writeFileSync(patchPath, patch);
  });

  for (const fault of ['corrupt', 'missing']) {
    it(`retains the confirmed version after a ${fault} diff and process restart`, async () => {
      try {
        if (fault === 'corrupt')
          writeFileSync(patchPath, Buffer.from('invalid patch archive'));
        else unlinkSync(patchPath);
        await element(by.id('check-update')).tap();
        await waitFor(element(by.id('last-event')))
          .toHaveText('lastEvent: errorDownload')
          .withTimeout(120000);
        await label(LOCAL_UPDATE_LABELS.full);
        await currentHash(LOCAL_UPDATE_HASHES.full);
        await device.launchApp(launchOptions());
        await device.setURLBlacklist([`.*:${LOCAL_UPDATE_PORT}.*`]);
        await label(LOCAL_UPDATE_LABELS.full);
        await currentHash(LOCAL_UPDATE_HASHES.full);
      } finally {
        writeFileSync(patchPath, patch);
      }
    });
  }
});
