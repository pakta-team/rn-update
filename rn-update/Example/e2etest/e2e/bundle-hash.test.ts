/**
 * [INPUT]: 依赖 Detox 设备与应用 bundleHash 诊断、Android/iOS 构建产物、Node 加密/文件 API 与 node-stream-zip
 * [OUTPUT]: 对外提供 bundleHash 字节摘要一致性端到端断言
 * [POS]: e2etest 的跨平台 bundle 完整性验收叶节点，不参与应用运行时
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { by, device, element, waitFor } from 'detox';
import StreamZip from 'node-stream-zip';

// bundleHash 铁律验收(BUNDLEHASH_MIGRATION.md §0/§2.7):客户端原生算出的
// bundleHash 必须与包内嵌入 bundle 的 sha256 逐字节一致——两侧对不上,服务端
// 就会确信 pdiff 可用而实际 hpatch 源校验失败,比 buildTime 启发式更糟。
//
// iOS 模拟器可直读 NSUserDefaults 缓存；Android 的 Google Play AVD
// 禁止 adb root/run-as release 包，因此从样例 UI 读取同一个原生方法的结果。
// 两条路径最终都与 Node 对包内 bundle 计算的 sha256 比对。
//
// Android 有独立的验证价值:它的哈希实现(MessageDigest)与被哈希字节的来源
// (AssetManager.open 对硬编码资产名)都与 iOS 不同——尤其后者,APK 条目可能
// 压缩存储,AssetManager 读出的解压字节必须等于 CLI 解包提取的条目字节。
const IOS_APP_PATH = path.resolve(
  __dirname,
  '../ios/build/Build/Products/Release-iphonesimulator/AwesomeProject.app'
);
const ANDROID_APK_PATH = path.resolve(
  __dirname,
  '../android/app/build/outputs/apk/release/app-release.apk'
);
const IOS_DEFAULTS_KEY = 'REACTNATIVECN_PAKTA_BUNDLEHASH_KEY';
const POLL_TIMEOUT_MS = 60000;
const POLL_INTERVAL_MS = 1000;

function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

async function readZipEntry(
  archivePath: string,
  entryPath: string
): Promise<Buffer> {
  const archive = new StreamZip.async({ file: archivePath });
  try {
    return await archive.entryData(entryPath);
  } finally {
    await archive.close();
  }
}

// 缓存格式 "cacheKey|hash",hash 恒为末段
function extractHash(raw: string): string | null {
  const hash = raw.split('|').pop() ?? '';
  return /^[0-9a-f]{64}$/.test(hash) ? hash : null;
}

function readIosCachedBundleHash(
  udid: string,
  bundleId: string
): string | null {
  try {
    // app 容器的 NSUserDefaults 对 `simctl spawn defaults read` 不可见,
    // 必须定位容器后直接读 plist。
    const container = execSync(
      `xcrun simctl get_app_container ${udid} ${bundleId} data`,
      { stdio: ['ignore', 'pipe', 'ignore'] }
    )
      .toString()
      .trim();
    const raw = execSync(
      `plutil -extract ${IOS_DEFAULTS_KEY} raw -o - "${container}/Library/Preferences/${bundleId}.plist"`,
      { stdio: ['ignore', 'pipe', 'ignore'] }
    )
      .toString()
      .trim();
    return extractHash(raw);
  } catch {
    // 容器/plist/key 尚不存在:原生还没算完,继续轮询
    return null;
  }
}

describe('bundleHash content identity', () => {
  it('natively computed bundleHash equals sha256 of the embedded bundle', async () => {
    const platform = device.getPlatform();

    let expected: string;
    let readActual: () => string | null;

    if (platform === 'ios') {
      const bundlePath = path.join(IOS_APP_PATH, 'main.jsbundle');
      if (!existsSync(bundlePath)) {
        throw new Error(`embedded bundle not found at ${bundlePath}`);
      }
      expected = sha256Hex(readFileSync(bundlePath));
      const bundleId = execSync(
        `/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "${IOS_APP_PATH}/Info.plist"`
      )
        .toString()
        .trim();
      readActual = () => readIosCachedBundleHash(device.id, bundleId);
    } else if (platform === 'android') {
      if (!existsSync(ANDROID_APK_PATH)) {
        throw new Error(`release apk not found at ${ANDROID_APK_PATH}`);
      }
      // 提取的是 zip 条目的原始内容字节——与客户端
      // AssetManager.open 返回的字节、CLI getApkInfo 提取的字节同源。
      expected = sha256Hex(
        await readZipEntry(ANDROID_APK_PATH, 'assets/index.android.bundle')
      );
      readActual = () => null;
    } else {
      // Harmony 走独立 runner,不经 detox。
      return;
    }

    await device.launchApp({ newInstance: true });

    if (platform === 'android') {
      await waitFor(element(by.id('bundle-hash')))
        .toHaveText(`bundleHash: ${expected}`)
        .withTimeout(POLL_TIMEOUT_MS);
      return;
    }

    // JS 启动即预取 → 原生后台懒计算并写缓存;轮询等它落盘
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let actual: string | null = null;
    while (Date.now() < deadline) {
      actual = readActual();
      if (actual) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    if (!actual) {
      throw new Error(
        `native bundleHash was not cached within ${POLL_TIMEOUT_MS}ms — ` +
          'is the JS prefetch (core.ts) running and the native method present?'
      );
    }
    // 显式比较:detox 的 jest 环境把全局 expect 换成了元素断言版,不能对普通
    // 值用 .toBe。
    if (actual !== expected) {
      throw new Error(
        `bundleHash mismatch — native computed ${actual}, ` +
          `sha256 of the embedded bundle is ${expected}`
      );
    }
  });
});
