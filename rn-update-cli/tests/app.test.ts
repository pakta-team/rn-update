/**
 * [INPUT]: 依赖 app 命令、可替换 CLI API 与 update.json 文件边界
 * [OUTPUT]: 验证应用选择、独立服务 UUIDv7、旧/独立服务创建契约及非交互保护
 * [POS]: CLI 应用命令回归边界，锁定 standalone createApp 能选中 Go 服务生成的 UUIDv7，且原生回退地址不会误写入描述
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import fs from 'fs';
import * as api from '../src/api';
import {
  assertPlatform,
  chooseApp,
  getAppCommands,
  getOrCreateChannel,
  getSelectedApp,
} from '../src/app';

describe('assertPlatform', () => {
  test('accepts ios', () => {
    expect(assertPlatform('ios')).toBe('ios');
  });

  test('accepts android', () => {
    expect(assertPlatform('android')).toBe('android');
  });

  test('accepts harmony', () => {
    expect(assertPlatform('harmony')).toBe('harmony');
  });

  test('throws on invalid platform string', () => {
    expect(() => assertPlatform('windows')).toThrow(
      /windows|unsupportedPlatform/,
    );
  });

  test('throws on empty string', () => {
    expect(() => assertPlatform('')).toThrow();
  });
});

describe('getSelectedApp', () => {
  let readFileSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    readFileSpy?.mockRestore();
  });

  test('returns appId and appKey from update.json for ios', async () => {
    const updateJson = {
      ios: { appId: 42, appKey: 'key-ios-abc' },
      android: { appId: 99, appKey: 'key-android-xyz' },
    };
    readFileSpy = spyOn(fs.promises, 'readFile').mockResolvedValue(
      JSON.stringify(updateJson),
    );

    const result = await getSelectedApp('ios');

    expect(result).toEqual({
      appId: '42',
      appKey: 'key-ios-abc',
      platform: 'ios',
    });
  });

  test('returns appId and appKey from update.json for android', async () => {
    const updateJson = {
      android: { appId: 7, appKey: 'key-android' },
    };
    readFileSpy = spyOn(fs.promises, 'readFile').mockResolvedValue(
      JSON.stringify(updateJson),
    );

    const result = await getSelectedApp('android');

    expect(result).toEqual({
      appId: '7',
      appKey: 'key-android',
      platform: 'android',
    });
  });

  test('throws when update.json does not exist (ENOENT)', async () => {
    const enoentError = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    readFileSpy = spyOn(fs.promises, 'readFile').mockRejectedValue(enoentError);

    await expect(getSelectedApp('ios')).rejects.toThrow(
      /selectApp|appNotSelected/,
    );
  });

  test('throws original error for non-ENOENT read failures', async () => {
    const permError = Object.assign(new Error('Permission denied'), {
      code: 'EACCES',
    });
    readFileSpy = spyOn(fs.promises, 'readFile').mockRejectedValue(permError);

    await expect(getSelectedApp('ios')).rejects.toThrow('Permission denied');
  });

  test('throws when platform key is missing from update.json', async () => {
    readFileSpy = spyOn(fs.promises, 'readFile').mockResolvedValue(
      JSON.stringify({ android: { appId: 1, appKey: 'k' } }),
    );

    await expect(getSelectedApp('ios')).rejects.toThrow(
      /selectApp|appNotSelected/,
    );
  });

  test('converts appId to string', async () => {
    readFileSpy = spyOn(fs.promises, 'readFile').mockResolvedValue(
      JSON.stringify({
        harmony: { appId: 12345, appKey: 'harmony-key' },
      }),
    );

    const result = await getSelectedApp('harmony');
    expect(result.appId).toBe('12345');
    expect(typeof result.appId).toBe('string');
  });
});

describe('getOrCreateChannel', () => {
  let getChannelsSpy: ReturnType<typeof spyOn>;
  let createChannelSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    getChannelsSpy?.mockRestore();
    createChannelSpy?.mockRestore();
  });

  test('creates a missing channel using its code as the display name', async () => {
    getChannelsSpy = spyOn(api, 'getChannels').mockResolvedValue([]);
    createChannelSpy = spyOn(api, 'createChannel').mockResolvedValue({
      id: 'channel-test',
      code: 'test',
      name: 'test',
    });

    await expect(getOrCreateChannel('app-1', ' test ')).resolves.toEqual({
      channel: { id: 'channel-test', code: 'test', name: 'test' },
      created: true,
    });
    expect(createChannelSpy).toHaveBeenCalledWith('app-1', 'test', 'test');
  });

  test.each(['Beta', 'beta'])(
    'prefers exact historical %s over casefold',
    async (code) => {
      const channels = [
        { id: 'upper', code: 'Beta', name: 'Beta' },
        { id: 'lower', code: 'beta', name: 'beta' },
      ];
      getChannelsSpy = spyOn(api, 'getChannels').mockResolvedValue(channels);
      createChannelSpy = spyOn(api, 'createChannel').mockResolvedValue(
        channels[0],
      );
      expect((await getOrCreateChannel('app-1', code)).channel.code).toBe(code);
      expect(createChannelSpy).not.toHaveBeenCalled();
    },
  );

  test('rejects ambiguous casefold with zero channel writes', async () => {
    getChannelsSpy = spyOn(api, 'getChannels').mockResolvedValue([
      { id: 'upper', code: 'Beta', name: 'Beta' },
      { id: 'lower', code: 'beta', name: 'beta' },
    ]);
    createChannelSpy = spyOn(api, 'createChannel').mockResolvedValue({
      id: 'unused',
      code: 'beta',
      name: 'beta',
    });
    await expect(getOrCreateChannel('app-1', 'BETA')).rejects.toThrow();
    expect(createChannelSpy).not.toHaveBeenCalled();
  });

  test('does not create a lowercase replacement for missing mixed-case identity', async () => {
    getChannelsSpy = spyOn(api, 'getChannels').mockResolvedValue([]);
    createChannelSpy = spyOn(api, 'createChannel').mockResolvedValue({
      id: 'unused',
      code: 'beta',
      name: 'beta',
    });
    await expect(getOrCreateChannel('app-1', 'Beta')).rejects.toThrow();
    expect(createChannelSpy).not.toHaveBeenCalled();
  });

  test('treats a concurrent channel creation as idempotent', async () => {
    getChannelsSpy = spyOn(api, 'getChannels')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'channel-test', code: 'test', name: 'test' },
      ]);
    createChannelSpy = spyOn(api, 'createChannel').mockRejectedValue(
      new Error('duplicate channel'),
    );

    await expect(getOrCreateChannel('app-1', 'test')).resolves.toEqual({
      channel: { id: 'channel-test', code: 'test', name: 'test' },
      created: false,
    });
  });
});

describe('appCommands.createApp', () => {
  let postSpy: ReturnType<typeof spyOn>;
  let getSpy: ReturnType<typeof spyOn>;
  let readFileSpy: ReturnType<typeof spyOn>;
  let writeFileSpy: ReturnType<typeof spyOn>;
  let consoleLogSpy: ReturnType<typeof spyOn>;
  const originalServiceURL = process.env.RNU_SERVICE_URL;

  afterEach(() => {
    postSpy?.mockRestore();
    getSpy?.mockRestore();
    readFileSpy?.mockRestore();
    writeFileSpy?.mockRestore();
    consoleLogSpy?.mockRestore();
    if (originalServiceURL === undefined) {
      delete process.env.RNU_SERVICE_URL;
    } else {
      process.env.RNU_SERVICE_URL = originalServiceURL;
    }
  });

  test('selects the created app when invoked without appCommands as this', async () => {
    postSpy = spyOn(api, 'post').mockResolvedValue({ id: 10 });
    getSpy = spyOn(api, 'get').mockResolvedValue({ appKey: 'key-ios-10' });
    const enoentError = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    readFileSpy = spyOn(fs.promises, 'readFile').mockRejectedValue(enoentError);
    writeFileSpy = spyOn(fs.promises, 'writeFile').mockResolvedValue();
    consoleLogSpy = spyOn(console, 'log').mockImplementation(() => {});

    const createApp = getAppCommands().createApp;
    await createApp({
      options: {
        name: 'SmallWOD',
        downloadUrl: '',
        platform: 'ios',
      },
    });

    expect(postSpy).toHaveBeenCalledWith('/app/create', {
      name: 'SmallWOD',
      platform: 'ios',
      downloadUrl: '',
    });
    expect(getSpy).toHaveBeenCalledWith('/app/10');
    expect(writeFileSpy).toHaveBeenCalledWith(
      'update.json',
      JSON.stringify(
        {
          ios: {
            appId: 10,
            appKey: 'key-ios-10',
          },
        },
        null,
        4,
      ),
      'utf8',
    );
  });

  test('maps standalone downloadUrl to the default-channel native fallback', async () => {
    process.env.RNU_SERVICE_URL = 'https://updates.example';
    const appId = '11111111-1111-4111-8111-111111111111';
    postSpy = spyOn(api, 'post').mockResolvedValue({ data: { id: appId } });
    getSpy = spyOn(api, 'get').mockResolvedValue({
      data: { appKey: 'standalone-key', platform: 'android' },
    });
    readFileSpy = spyOn(fs.promises, 'readFile').mockRejectedValue(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    );
    writeFileSpy = spyOn(fs.promises, 'writeFile').mockResolvedValue();
    consoleLogSpy = spyOn(console, 'log').mockImplementation(() => {});

    await getAppCommands().createApp({
      options: {
        name: 'Standalone',
        downloadUrl: 'https://cdn.example/native.apk',
        platform: 'android',
      },
    });

    expect(postSpy).toHaveBeenCalledWith('/admin/api/v1/apps', {
      name: 'Standalone',
      platform: 'android',
      nativePackageUrl: 'https://cdn.example/native.apk',
    });
  });
});

describe('non-interactive guards', () => {
  afterEach(() => {
    global.NO_INTERACTIVE = undefined;
  });

  test('chooseApp fails instead of looping forever when nothing can answer', async () => {
    global.NO_INTERACTIVE = true;
    const getSpy = spyOn(api, 'get').mockResolvedValue({
      data: [{ id: 1, name: 'DemoApp', platform: 'ios' }],
    });
    const logSpy = spyOn(console, 'log').mockImplementation(() => {});
    try {
      await expect(chooseApp('ios')).rejects.toThrow();
      expect(getSpy).not.toHaveBeenCalled();
    } finally {
      getSpy.mockRestore();
      logSpy.mockRestore();
    }
  });

  test('selectApp rejects malformed or non-positive app ids', async () => {
    const getSpy = spyOn(api, 'get').mockRejectedValue(
      new Error('must not reach the server'),
    );
    try {
      for (const id of ['abc', '12abc', '1.5', '12e3', '0', '-1']) {
        await expect(
          getAppCommands().selectApp({
            args: [id],
            options: { platform: 'ios' },
          }),
        ).rejects.toThrow();
      }
      expect(getSpy).not.toHaveBeenCalled();
    } finally {
      getSpy.mockRestore();
    }
  });

  test('selectApp accepts a standalone UUIDv7 and persists it unchanged', async () => {
    process.env.RNU_SERVICE_URL = 'https://updates.example';
    const appId = '01a07c97-1953-7524-a38e-7c92b0d766ee';
    const getSpy = spyOn(api, 'get').mockResolvedValue({
      data: { appKey: 'standalone-key', platform: 'android' },
    });
    const readFileSpy = spyOn(fs.promises, 'readFile').mockRejectedValue(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    );
    const writeFileSpy = spyOn(fs.promises, 'writeFile').mockResolvedValue();
    try {
      await getAppCommands().selectApp({
        args: [appId],
        options: { platform: 'android' },
      });
      expect(getSpy).toHaveBeenCalledWith(`/admin/api/v1/apps/${appId}`);
      expect(writeFileSpy).toHaveBeenCalledWith(
        'update.json',
        JSON.stringify(
          { android: { appId, appKey: 'standalone-key' } },
          null,
          4,
        ),
        'utf8',
      );
    } finally {
      getSpy.mockRestore();
      readFileSpy.mockRestore();
      writeFileSpy.mockRestore();
    }
  });

  test('selectApp rejects a response without an app key', async () => {
    const getSpy = spyOn(api, 'get').mockResolvedValue({ platform: 'ios' });
    const writeFileSpy = spyOn(fs.promises, 'writeFile').mockResolvedValue();
    try {
      await expect(
        getAppCommands().selectApp({
          args: ['12'],
          options: { platform: 'ios' },
        }),
      ).rejects.toThrow();
      expect(writeFileSpy).not.toHaveBeenCalled();
    } finally {
      getSpy.mockRestore();
      writeFileSpy.mockRestore();
    }
  });

  test('selectApp rejects an app belonging to another platform', async () => {
    const getSpy = spyOn(api, 'get').mockResolvedValue({
      appKey: 'android-key',
      platform: 'android',
    });
    const writeFileSpy = spyOn(fs.promises, 'writeFile').mockResolvedValue();
    try {
      await expect(
        getAppCommands().selectApp({
          args: ['12'],
          options: { platform: 'ios' },
        }),
      ).rejects.toThrow();
      expect(writeFileSpy).not.toHaveBeenCalled();
    } finally {
      getSpy.mockRestore();
      writeFileSpy.mockRestore();
    }
  });
});
