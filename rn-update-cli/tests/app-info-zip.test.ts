/**
 * [INPUT]: 依赖共享 ZIP/二进制 XML 夹具、APK/IPA 解析器与真实 ZIP 条目读取
 * [OUTPUT]: 验证 manifest 属性、bundle 精确路径、嵌套 HAP 与 XML/binary plist 的解析契约
 * [POS]: CLI 原生包格式边界回归；与入口测试共享制品写入器以避免两套格式构造
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ApkBundleFileName, IpaBundleFileName } from '../src/utils';
import { parseApkManifest } from '../src/utils/app-info-parser/apk';
import { parsePlist } from '../src/utils/app-info-parser/ipa';
import { readZipEntries } from '../src/utils/app-info-parser/zip';
import { binaryXml, writeZip } from './fixtures/native-package-fixtures';

function mkTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const TYPE_REFERENCE = 0x01;
const TYPE_STRING = 0x03;
const TYPE_INT_DEC = 0x10;
const TYPE_INT_BOOLEAN = 0x12;

describe('parseApkManifest', () => {
  test('reads versionName and application meta-data', () => {
    const manifest = binaryXml({
      name: 'manifest',
      attrs: [['versionName', TYPE_STRING, '1.2.3\u0000\u0000']],
      children: [
        { name: 'uses-permission', attrs: [['name', TYPE_STRING, 'x']] },
        {
          name: 'application',
          attrs: [['label', TYPE_REFERENCE, 0x7f010000]],
          children: [
            {
              name: 'meta-data',
              attrs: [
                ['name', TYPE_STRING, 'pakta_build_time'],
                ['value', TYPE_INT_DEC, 1700000000],
              ],
            },
            {
              name: 'meta-data',
              attrs: [
                ['name', TYPE_STRING, 'enabled'],
                ['value', TYPE_INT_BOOLEAN, 0],
              ],
            },
            {
              name: 'activity',
              attrs: [['name', TYPE_STRING, '.Main']],
              children: [
                {
                  name: 'meta-data',
                  attrs: [['name', TYPE_STRING, 'nested']],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(parseApkManifest(manifest)).toEqual({
      versionName: '1.2.3',
      metaData: [
        { name: 'pakta_build_time', value: 1700000000 },
        { name: 'enabled', value: false },
      ],
    });
  });

  test('leaves an unresolvable reference undefined without resources.arsc', () => {
    const manifest = binaryXml({
      name: 'manifest',
      attrs: [['versionName', TYPE_REFERENCE, 0x7f0f0001]],
    });
    expect(parseApkManifest(manifest)).toEqual({
      versionName: undefined,
      metaData: [],
    });
  });

  test('rejects a buffer that is not binary XML', () => {
    expect(() => parseApkManifest(Buffer.alloc(16))).toThrow(
      'Parse AndroidManifest.xml error: Invalid XML header',
    );
  });
});

describe('readZipEntries', () => {
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = mkTempDir('rn-update-app-info-zip-');
  });

  afterEach(() => {
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('reads entries in pattern order, matching lowercased names too', async () => {
    const zipPath = path.join(tempRoot, 'app.zip');
    await writeZip(zipPath, {
      'AndroidManifest.xml': 'manifest',
      'base/manifest/AndroidManifest.xml': 'aab manifest',
      'res/icon.png': 'icon',
    });

    const [manifest, aabManifest, missing] = await readZipEntries(zipPath, [
      /^androidmanifest\.xml$/,
      // case-sensitive patterns still match the original name
      /^base\/manifest\/AndroidManifest\.xml$/,
      /^nothing$/,
    ]);
    expect(manifest?.toString()).toBe('manifest');
    expect(aabManifest?.toString()).toBe('aab manifest');
    expect(missing).toBeUndefined();
  });

  test('bundle patterns only match the exact bundle entry, not .map/.backup siblings', async () => {
    const apkPath = path.join(tempRoot, 'app.apk');
    await writeZip(apkPath, {
      'assets/index.android.bundle': 'REAL_BUNDLE',
      // later entries used to overwrite the real match via the unanchored regex
      'assets/index.android.bundle.map': 'SOURCE_MAP',
      'assets/index.android.bundle.backup': 'BACKUP',
      'foo/assets/index.android.bundle.tmp': 'TMP',
    });

    const [apkBundle] = await readZipEntries(apkPath, [ApkBundleFileName]);
    expect(apkBundle?.toString()).toBe('REAL_BUNDLE');

    const ipaPath = path.join(tempRoot, 'app-bundle.ipa');
    await writeZip(ipaPath, {
      'Payload/Test.app/main.jsbundle': 'REAL_IPA_BUNDLE',
      'Payload/Test.app/main.jsbundle.map': 'IPA_SOURCE_MAP',
      'Payload/Test.app/mainXjsbundle': 'NOT_A_BUNDLE',
    });

    const [ipaBundle] = await readZipEntries(ipaPath, [IpaBundleFileName]);
    expect(ipaBundle?.toString()).toBe('REAL_IPA_BUNDLE');
  });

  test('walks into nested .hap archives', async () => {
    const hapPath = path.join(tempRoot, 'entry.hap');
    await writeZip(hapPath, {
      'resources/rawfile/bundle.harmony.js': 'bundle',
      'resources/rawfile/update.json': '{"harmony":{}}',
    });
    const appPath = path.join(tempRoot, 'app.app');
    await writeZip(appPath, {
      'entry.hap': fs.readFileSync(hapPath),
      'pack.info': '{}',
    });

    const [bundle, updateJson, meta] = await readZipEntries(appPath, [
      /^resources\/rawfile\/bundle\.harmony\.js$/,
      /^resources\/rawfile\/update\.json$/,
      /^resources\/rawfile\/meta\.json$/,
    ]);
    expect(bundle?.toString()).toBe('bundle');
    expect(updateJson?.toString()).toBe('{"harmony":{}}');
    expect(meta).toBeUndefined();
  });

  test('rejects a file that is not a zip', async () => {
    const notZip = path.join(tempRoot, 'broken.app');
    fs.writeFileSync(notZip, 'not a zip');
    await expect(readZipEntries(notZip, [/x/])).rejects.toThrow();
  });
});

describe('parsePlist', () => {
  test('parses an XML plist with the current plist package exports', async () => {
    const info = await parsePlist(
      Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>cn.reactnative.test</string>
  <key>CFBundleShortVersionString</key>
  <string>1.2.3</string>
</dict>
</plist>`),
    );

    expect(info.CFBundleIdentifier).toBe('cn.reactnative.test');
    expect(info.CFBundleShortVersionString).toBe('1.2.3');
  });

  test('rejects an unknown plist format', async () => {
    await expect(parsePlist(Buffer.from('garbage'))).rejects.toThrow(
      'Unknown plist buffer type.',
    );
  });
});
