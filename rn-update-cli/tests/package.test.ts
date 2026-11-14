/**
 * [INPUT]: 依赖 packageCommands、原生包解析/ZIP 工具、可替换 CLI API 与英文 locale 固定器
 * [OUTPUT]: 验证 buildTime 原样字符串化、parse JSON 剔除 bundle 字节、包体选择/删除、精简上传与 standalone 版本组裁决契约
 * [POS]: CLI package 命令回归边界，锁定上传前版本组裁决到 multipart/NativeVersion 的完整数据流
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import fs from 'fs';
import i18next from 'i18next';
import os from 'os';
import path from 'path';
import { ZipFile as YazlZipFile } from 'yazl';
import * as api from '../src/api';
import {
  choosePackage,
  normalizeUploadBuildTime,
  packageCommands,
} from '../src/package';
import * as utils from '../src/utils';
import { enumZipEntries } from '../src/utils/zip-entries';

async function createZip(
  output: string,
  entries: Record<string, string>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const zipFile = new YazlZipFile();
    zipFile.outputStream.once('error', reject);
    zipFile.outputStream
      .pipe(fs.createWriteStream(output))
      .once('error', reject)
      .once('close', () => resolve());
    for (const [entryName, value] of Object.entries(entries)) {
      zipFile.addBuffer(Buffer.from(value), entryName);
    }
    zipFile.end();
  });
}

describe('normalizeUploadBuildTime', () => {
  test('converts number to string', () => {
    expect(normalizeUploadBuildTime(1234567890)).toBe('1234567890');
  });

  test('keeps string as-is', () => {
    expect(normalizeUploadBuildTime('1234567890')).toBe('1234567890');
    expect(normalizeUploadBuildTime('  1234567890  ')).toBe('  1234567890  ');
    expect(normalizeUploadBuildTime(' \t\n ')).toBe(' \t\n ');
    expect(normalizeUploadBuildTime('')).toBe('');
  });

  test('converts non-finite numbers to strings', () => {
    expect(normalizeUploadBuildTime(Number.NaN)).toBe('NaN');
    expect(normalizeUploadBuildTime(Number.POSITIVE_INFINITY)).toBe('Infinity');
    expect(normalizeUploadBuildTime(Number.NEGATIVE_INFINITY)).toBe(
      '-Infinity',
    );
  });

  test('converts undefined to string', () => {
    expect(normalizeUploadBuildTime(undefined)).toBe('undefined');
  });

  test('converts null to string', () => {
    expect(normalizeUploadBuildTime(null)).toBe('null');
  });

  test('converts 0 to string', () => {
    expect(normalizeUploadBuildTime(0)).toBe('0');
  });
});

// Test the internal helper functions by re-implementing and verifying the logic
describe('package helper logic', () => {
  // parseBooleanOption equivalent
  function parseBooleanOption(value: unknown): boolean {
    return value === true || value === 'true';
  }

  test('parseBooleanOption returns true for boolean true', () => {
    expect(parseBooleanOption(true)).toBe(true);
  });

  test('parseBooleanOption returns true for string "true"', () => {
    expect(parseBooleanOption('true')).toBe(true);
  });

  test('parseBooleanOption returns false for false', () => {
    expect(parseBooleanOption(false)).toBe(false);
  });

  test('parseBooleanOption returns false for "false"', () => {
    expect(parseBooleanOption('false')).toBe(false);
  });

  test('parseBooleanOption returns false for undefined', () => {
    expect(parseBooleanOption(undefined)).toBe(false);
  });

  test('parseBooleanOption returns false for 1', () => {
    expect(parseBooleanOption(1)).toBe(false);
  });

  // parseCsvOption equivalent
  function parseCsvOption(value: unknown): string[] | null {
    if (typeof value !== 'string') return null;
    const parsed = value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    return parsed.length > 0 ? parsed : null;
  }

  test('parseCsvOption parses simple CSV', () => {
    expect(parseCsvOption('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  test('parseCsvOption trims whitespace', () => {
    expect(parseCsvOption(' a , b , c ')).toEqual(['a', 'b', 'c']);
  });

  test('parseCsvOption filters empty values', () => {
    expect(parseCsvOption('a,,b,,c')).toEqual(['a', 'b', 'c']);
  });

  test('parseCsvOption returns null for empty string', () => {
    expect(parseCsvOption('')).toBeNull();
  });

  test('parseCsvOption returns null for non-string', () => {
    expect(parseCsvOption(123)).toBeNull();
    expect(parseCsvOption(undefined)).toBeNull();
    expect(parseCsvOption(null)).toBeNull();
  });

  test('parseCsvOption handles single item', () => {
    expect(parseCsvOption('foo')).toEqual(['foo']);
  });

  // ensureFileByExt equivalent
  function ensureFileByExt(
    filePath: string | undefined,
    extension: string,
  ): string {
    if (!filePath?.endsWith(extension)) {
      throw new Error(`Usage: expected ${extension} file`);
    }
    return filePath;
  }

  test('ensureFileByExt accepts matching extension', () => {
    expect(ensureFileByExt('app.ipa', '.ipa')).toBe('app.ipa');
    expect(ensureFileByExt('debug.apk', '.apk')).toBe('debug.apk');
    expect(ensureFileByExt('release.aab', '.aab')).toBe('release.aab');
    expect(ensureFileByExt('bundle.app', '.app')).toBe('bundle.app');
  });

  test('ensureFileByExt rejects wrong extension', () => {
    expect(() => ensureFileByExt('app.apk', '.ipa')).toThrow();
  });

  test('ensureFileByExt rejects undefined', () => {
    expect(() => ensureFileByExt(undefined, '.ipa')).toThrow();
  });

  test('ensureFileByExt rejects empty string', () => {
    expect(() => ensureFileByExt('', '.apk')).toThrow();
  });
});

describe('packageCommands parse JSON', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let infoSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    infoSpy?.mockRestore();
  });

  for (const [command, parser, filePath] of [
    ['parseApp', 'getAppInfo', 'release.app'],
    ['parseApk', 'getApkInfo', 'release.apk'],
    ['parseIpa', 'getIpaInfo', 'release.ipa'],
    ['parseAab', 'getAabInfo', 'release.aab'],
  ] as const) {
    test(`${command} prints metadata JSON without bundle bytes`, async () => {
      const metadata = {
        versionName: '1.0.0',
        buildTime: '  opaque-build  ',
        bundleHash: 'a'.repeat(64),
        channel: 'production',
        appId: '100',
        appKey: 'test-app-key',
      };
      infoSpy = spyOn(utils, parser).mockResolvedValue({
        ...metadata,
        bundleFile: Buffer.from('private-bundle-bytes'),
      });

      await packageCommands[command]({ args: [filePath] });

      expect(infoSpy).toHaveBeenCalledTimes(1);
      expect(infoSpy).toHaveBeenCalledWith(filePath);
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const [output] = consoleSpy.mock.calls[0];
      expect(typeof output).toBe('string');
      const parsed = JSON.parse(output);
      expect(parsed).toEqual(metadata);
      expect(parsed).not.toHaveProperty('bundleFile');
      expect(output).not.toContain('private-bundle-bytes');
    });
  }
});

describe('packageCommands.deletePackage', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let deleteSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    deleteSpy = spyOn(api, 'doDelete').mockResolvedValue({});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    deleteSpy.mockRestore();
  });

  test('deletes one native package through the legacy endpoint', async () => {
    await packageCommands.deletePackage({
      options: {
        appId: '100',
        packageId: '10',
      },
    });

    expect(deleteSpy).toHaveBeenCalledWith('/app/100/package/10');
  });

  test('deletes multiple native packages through the batch endpoint', async () => {
    await packageCommands.deletePackage({
      options: {
        appId: '100',
        packageIds: '10,11',
      },
    });

    expect(deleteSpy).toHaveBeenCalledWith('/app/100/package', {
      packageIds: [10, 11],
    });
  });

  test('accepts comma separated ids through the legacy packageId option', async () => {
    await packageCommands.deletePackage({
      options: {
        appId: '100',
        packageId: '10,11',
      },
    });

    expect(deleteSpy).toHaveBeenCalledWith('/app/100/package', {
      packageIds: [10, 11],
    });
  });
});

describe('packageCommands native upload', () => {
  let tempRoot = '';
  let consoleSpy: ReturnType<typeof spyOn>;
  let infoSpy: ReturnType<typeof spyOn>;
  let postSpy: ReturnType<typeof spyOn>;
  let uploadSpy: ReturnType<typeof spyOn>;
  let channelsSpy: ReturnType<typeof spyOn>;
  let createChannelSpy: ReturnType<typeof spyOn>;
  let packagesSpy: ReturnType<typeof spyOn>;
  let originalServiceURL: string | undefined;

  beforeEach(async () => {
    await i18next.changeLanguage('en');
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rnu-package-upload-'));
    originalServiceURL = process.env.RNU_SERVICE_URL;
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    infoSpy = spyOn(utils, 'getApkInfo').mockResolvedValue({
      versionName: '1.0.0',
      buildTime: 123,
    });
    postSpy = spyOn(api, 'post').mockResolvedValue({ id: 9 });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    infoSpy.mockRestore();
    postSpy.mockRestore();
    uploadSpy?.mockRestore();
    channelsSpy?.mockRestore();
    createChannelSpy?.mockRestore();
    packagesSpy?.mockRestore();
    if (originalServiceURL === undefined) {
      delete process.env.RNU_SERVICE_URL;
    } else {
      process.env.RNU_SERVICE_URL = originalServiceURL;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('uploads the temporary slim package and removes it afterwards', async () => {
    const source = path.join(tempRoot, 'source.apk');
    await createZip(source, {
      'AndroidManifest.xml': 'manifest',
      'assets/index.android.bundle': 'bundle',
      'classes.dex': 'native-code',
      'res/drawable/icon.png': 'image',
    });

    let uploadedPath = '';
    uploadSpy = spyOn(api, 'uploadFile').mockImplementation(
      async (filePath) => {
        uploadedPath = filePath;
        expect(filePath).not.toBe(source);
        expect(path.extname(filePath)).toBe('.apk');

        const entries: string[] = [];
        await enumZipEntries(filePath, async (entry) => {
          if (!entry.fileName.endsWith('/')) {
            entries.push(entry.fileName);
          }
        });
        expect(entries.sort()).toEqual([
          'assets/index.android.bundle',
          'res/drawable/icon.png',
        ]);
        return { hash: 'slim-package-hash' } as never;
      },
    );

    await packageCommands.uploadApk({
      args: [source],
      options: { appId: '100' },
    });

    expect(uploadSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).toHaveBeenCalledWith(
      '/app/100/package/create',
      expect.objectContaining({
        buildTime: '123',
        hash: 'slim-package-hash',
        name: '1.0.0',
      }),
    );
    expect(fs.existsSync(uploadedPath)).toBe(false);
  });

  test('removes the temporary slim package when upload fails', async () => {
    const source = path.join(tempRoot, 'source.apk');
    await createZip(source, {
      'assets/index.android.bundle': 'bundle',
    });

    let uploadedPath = '';
    uploadSpy = spyOn(api, 'uploadFile').mockImplementation(
      async (filePath) => {
        uploadedPath = filePath;
        throw new Error('upload failed');
      },
    );

    await expect(
      packageCommands.uploadApk({
        args: [source],
        options: { appId: '100' },
      }),
    ).rejects.toThrow('upload failed');

    expect(fs.existsSync(uploadedPath)).toBe(false);
    expect(postSpy).not.toHaveBeenCalled();
  });

  test('uploads a same-JS standalone rebuild and binds its artifact location', async () => {
    process.env.RNU_SERVICE_URL = 'https://updates.example';
    const appId = '11111111-1111-4111-8111-111111111111';
    const channelId = '22222222-2222-4222-8222-222222222222';
    const source = path.join(tempRoot, 'source.apk');
    await createZip(source, {
      'assets/index.android.bundle': 'standalone-bundle',
      'res/drawable/icon.png': 'image',
    });
    infoSpy.mockResolvedValue({
      versionName: '2.0.0',
      buildTime: 'opaque-build',
      bundleHash: 'a'.repeat(64),
      channel: 'default',
    });
    channelsSpy = spyOn(api, 'getChannels').mockResolvedValue([
      { id: channelId, code: 'default', name: 'Default' },
    ]);
    packagesSpy = spyOn(api, 'getAllPackages').mockResolvedValue([
      {
        id: 'previous-build',
        name: '2.0.0',
        versionName: '2.0.0',
        channelId,
        bundleHash: 'a'.repeat(64),
        buildTime: 'previous-build',
      },
    ]);
    uploadSpy = spyOn(api, 'uploadFile').mockResolvedValue({
      hash: `apps/${appId}/artifacts/upload/package.apk`,
      key: `apps/${appId}/artifacts/33333333-3333-4333-8333-333333333333/package.apk`,
      url: 'https://cdn.example/package.apk',
    });
    postSpy.mockResolvedValue({
      data: { id: '44444444-4444-4444-8444-444444444444' },
    });

    await packageCommands.uploadApk({
      args: [source],
      options: { appId },
    });

    expect(postSpy).toHaveBeenCalledWith(
      `/admin/api/v1/apps/${appId}/versions`,
      expect.objectContaining({
        channelId,
        packageVersion: '2.0.0',
        bundleHash: 'a'.repeat(64),
        buildTime: 'opaque-build',
        packageKey: `apps/${appId}/artifacts/33333333-3333-4333-8333-333333333333/package.apk`,
        downloadUrl: 'https://cdn.example/package.apk',
        bundleOffset: expect.any(Number),
        bundleCompressedSize: expect.any(Number),
        bundleCompression: expect.any(Number),
      }),
    );
  });

  test.each(['Beta', 'beta'])(
    'preserves package %s and requires an exact --channel assertion',
    async (channel) => {
      const source = path.join(tempRoot, 'source.apk');
      await createZip(source, { 'assets/index.android.bundle': 'bundle' });
      infoSpy.mockResolvedValue({
        versionName: '1.0',
        buildTime: 'build',
        channel,
      });
      uploadSpy = spyOn(api, 'uploadFile').mockResolvedValue({ hash: 'hash' });
      await packageCommands.uploadApk({
        args: [source],
        options: { appId: '100', channel },
      });
      expect(postSpy).toHaveBeenCalledWith(
        '/app/100/package/create',
        expect.objectContaining({ channel }),
      );
      postSpy.mockClear();
      uploadSpy.mockClear();
      await expect(
        packageCommands.uploadApk({
          args: [source],
          options: {
            appId: '100',
            channel: channel === 'Beta' ? 'beta' : 'Beta',
          },
        }),
      ).rejects.toThrow();
      expect(postSpy).not.toHaveBeenCalled();
      expect(uploadSpy).not.toHaveBeenCalled();
    },
  );

  test('ambiguous package channel fails before any standalone writes', async () => {
    process.env.RNU_SERVICE_URL = 'https://updates.example';
    const source = path.join(tempRoot, 'source.apk');
    await createZip(source, { 'assets/index.android.bundle': 'bundle' });
    infoSpy.mockResolvedValue({
      versionName: '1.0',
      buildTime: 'build',
      bundleHash: 'a'.repeat(64),
      channel: 'BETA',
    });
    channelsSpy = spyOn(api, 'getChannels').mockResolvedValue([
      { id: 'upper', code: 'Beta', name: 'Beta' },
      { id: 'lower', code: 'beta', name: 'beta' },
    ]);
    createChannelSpy = spyOn(api, 'createChannel').mockResolvedValue({
      id: 'unused',
      code: 'beta',
      name: 'beta',
    });
    uploadSpy = spyOn(api, 'uploadFile').mockResolvedValue({ hash: 'unused' });
    await expect(
      packageCommands.uploadApk({
        args: [source],
        options: { appId: '100', channel: 'BETA' },
      }),
    ).rejects.toThrow();
    expect(createChannelSpy).not.toHaveBeenCalled();
    expect(postSpy).not.toHaveBeenCalled();
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  test('creates a missing standalone channel before uploading', async () => {
    process.env.RNU_SERVICE_URL = 'https://updates.example';
    const appId = '11111111-1111-4111-8111-111111111111';
    const channelId = '22222222-2222-4222-8222-222222222222';
    const source = path.join(tempRoot, 'source.apk');
    await createZip(source, { 'assets/index.android.bundle': 'test-channel' });
    infoSpy.mockResolvedValue({
      versionName: '2.0.0',
      buildTime: 'build-test',
      bundleHash: 'a'.repeat(64),
      channel: 'test',
    });
    channelsSpy = spyOn(api, 'getChannels').mockResolvedValue([]);
    createChannelSpy = spyOn(api, 'createChannel').mockResolvedValue({
      id: channelId,
      code: 'test',
      name: 'test',
    });
    packagesSpy = spyOn(api, 'getAllPackages').mockResolvedValue([]);
    uploadSpy = spyOn(api, 'uploadFile').mockResolvedValue({
      key: `apps/${appId}/artifacts/upload/package.apk`,
      url: 'https://cdn.example/package.apk',
    });
    postSpy.mockResolvedValue({
      data: { id: '44444444-4444-4444-8444-444444444444' },
    });

    await packageCommands.uploadApk({
      args: [source],
      options: { appId },
    });

    expect(createChannelSpy).toHaveBeenCalledWith(appId, 'test', 'test');
    expect(postSpy).toHaveBeenCalledWith(
      `/admin/api/v1/apps/${appId}/versions`,
      expect.objectContaining({ channelId, packageVersion: '2.0.0' }),
    );
  });

  test.each([
    ['Beta', ['Beta', 'beta'], 'Beta'],
    ['beta', ['Beta', 'beta'], 'beta'],
    ['BETA', ['Beta'], 'Beta'],
    ['Beta', ['beta'], 'beta'],
  ] as const)(
    'resolves standalone package %s before duplicate short-circuit',
    async (code, registered, expected) => {
      process.env.RNU_SERVICE_URL = 'https://updates.example';
      const source = path.join(tempRoot, 'source.apk');
      await createZip(source, { 'assets/index.android.bundle': 'bundle' });
      infoSpy.mockResolvedValue({
        versionName: '1.0',
        buildTime: 'build',
        bundleHash: 'a'.repeat(64),
        channel: code,
      });
      channelsSpy = spyOn(api, 'getChannels').mockResolvedValue(
        registered.map((channel) => ({
          id: channel,
          code: channel,
          name: channel,
        })),
      );
      packagesSpy = spyOn(api, 'getAllPackages').mockResolvedValue([
        {
          id: 'duplicate',
          name: '1.0',
          channelId: expected,
          buildTime: 'build',
          bundleHash: 'a'.repeat(64),
        },
      ]);
      createChannelSpy = spyOn(api, 'createChannel').mockRejectedValue(
        new Error('unexpected creation'),
      );
      uploadSpy = spyOn(api, 'uploadFile').mockRejectedValue(
        new Error('unexpected upload'),
      );
      await packageCommands.uploadApk({
        args: [source],
        options: { appId: '100', channel: code },
      });
      expect(createChannelSpy).not.toHaveBeenCalled();
      expect(uploadSpy).not.toHaveBeenCalled();
      expect(postSpy).not.toHaveBeenCalled();
    },
  );

  test('skips an exact standalone native identity before uploading bytes', async () => {
    process.env.RNU_SERVICE_URL = 'https://updates.example';
    const appId = '11111111-1111-4111-8111-111111111111';
    const channelId = '22222222-2222-4222-8222-222222222222';
    const source = path.join(tempRoot, 'source.apk');
    await createZip(source, { 'assets/index.android.bundle': 'same-bundle' });
    infoSpy.mockResolvedValue({
      versionName: '2.0.0',
      buildTime: 'build-1',
      bundleHash: 'a'.repeat(64),
      channel: 'default',
    });
    channelsSpy = spyOn(api, 'getChannels').mockResolvedValue([
      { id: channelId, code: 'default', name: 'Default' },
    ]);
    packagesSpy = spyOn(api, 'getAllPackages').mockResolvedValue([
      {
        id: 'existing',
        name: '2.0.0',
        versionName: '2.0.0',
        channelId,
        bundleHash: 'a'.repeat(64),
        buildTime: 'build-1',
      },
    ]);
    uploadSpy = spyOn(api, 'uploadFile').mockResolvedValue({} as never);

    await packageCommands.uploadApk({ args: [source], options: { appId } });

    expect(uploadSpy).not.toHaveBeenCalled();
    expect(postSpy).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('skipping duplicate upload'),
    );
  });

  test('rejects changed JS for an existing standalone version before upload', async () => {
    process.env.RNU_SERVICE_URL = 'https://updates.example';
    const appId = '11111111-1111-4111-8111-111111111111';
    const channelId = '22222222-2222-4222-8222-222222222222';
    const source = path.join(tempRoot, 'source.apk');
    await createZip(source, {
      'assets/index.android.bundle': 'changed-bundle',
    });
    infoSpy.mockResolvedValue({
      versionName: '2.0.0',
      buildTime: 'build-2',
      bundleHash: 'b'.repeat(64),
      channel: 'default',
    });
    channelsSpy = spyOn(api, 'getChannels').mockResolvedValue([
      { id: channelId, code: 'default', name: 'Default' },
    ]);
    packagesSpy = spyOn(api, 'getAllPackages').mockResolvedValue([
      {
        id: 'existing',
        name: '2.0.0',
        versionName: '2.0.0',
        channelId,
        bundleHash: 'a'.repeat(64),
        buildTime: 'build-1',
      },
    ]);
    uploadSpy = spyOn(api, 'uploadFile').mockResolvedValue({} as never);

    await expect(
      packageCommands.uploadApk({ args: [source], options: { appId } }),
    ).rejects.toThrow('Increment the native version');

    expect(uploadSpy).not.toHaveBeenCalled();
    expect(postSpy).not.toHaveBeenCalled();
  });
});

describe('choosePackage', () => {
  afterEach(() => {
    global.NO_INTERACTIVE = undefined;
  });

  test('fails instead of looping forever when nothing can answer', async () => {
    global.NO_INTERACTIVE = true;
    const logSpy = spyOn(console, 'log').mockImplementation(() => {});
    try {
      await expect(
        choosePackage('100', [{ id: 1, name: '1.0.0' }]),
      ).rejects.toThrow();
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });
});
