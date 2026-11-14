import {
  afterEach,
  beforeEach,
  describe,
  expect,
  type Mock,
  spyOn,
  test,
} from 'bun:test';
import fs from 'fs';
import * as api from '../src/api';
import {
  AppNotSelectedError,
  getAppCommands,
  getSelectedApp,
  resolveAppId,
} from '../src/app';
import { bundleCommands } from '../src/bundle';
import * as bundlePack from '../src/bundle-pack';
import * as bundleRunner from '../src/bundle-runner';
import * as utils from '../src/utils';
import * as addGitIgnoreModule from '../src/utils/add-gitignore';
import * as checkLockfileModule from '../src/utils/check-lockfile';
import * as hermesBaseModule from '../src/utils/hermes-base';
import { versionCommands } from '../src/versions';

const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
const selection = (platform: string, appId: number) =>
  JSON.stringify({ [platform]: { appId, appKey: `key-${appId}` } });

describe('resolveAppId', () => {
  let readFileSpy: Mock<typeof fs.promises.readFile>;

  afterEach(() => {
    readFileSpy?.mockRestore();
  });

  test('reads the selected app from update.json by default', async () => {
    readFileSpy = spyOn(fs.promises, 'readFile').mockResolvedValue(
      selection('ios', 42),
    );

    await expect(resolveAppId({ platform: 'ios' })).resolves.toBe('42');
    expect(readFileSpy).toHaveBeenCalledWith('update.json', 'utf8');
  });

  test('reads the selected app from an explicit config path', async () => {
    readFileSpy = spyOn(fs.promises, 'readFile').mockResolvedValue(
      selection('android', 7),
    );

    await expect(
      resolveAppId({ platform: 'android', config: 'configs/prod.json' }),
    ).resolves.toBe('7');
    expect(readFileSpy).toHaveBeenCalledWith('configs/prod.json', 'utf8');
  });

  test('an explicit appId wins and never reads the config', async () => {
    readFileSpy = spyOn(fs.promises, 'readFile').mockRejectedValue(
      new Error('config should not be read'),
    );
    const getSpy = spyOn(api, 'get').mockRejectedValue(
      new Error('no platform given, so no lookup'),
    );

    try {
      await expect(
        resolveAppId({ appId: '777', config: 'configs/prod.json' }),
      ).resolves.toBe('777');
      expect(readFileSpy).not.toHaveBeenCalled();
      expect(getSpy).not.toHaveBeenCalled();
    } finally {
      getSpy.mockRestore();
    }
  });

  test('still validates the platform next to an explicit appId', async () => {
    await expect(
      resolveAppId({ appId: '777', platform: 'windows' as any }),
    ).rejects.toThrow();
  });

  test('an explicit appId of the requested platform is accepted', async () => {
    const getSpy = spyOn(api, 'get').mockResolvedValue({
      id: 777,
      platform: 'ios',
    });

    try {
      await expect(
        resolveAppId({ appId: '777', platform: 'ios' }),
      ).resolves.toBe('777');
      expect(getSpy).toHaveBeenCalledWith('/app/777');
    } finally {
      getSpy.mockRestore();
    }
  });

  test('an explicit appId of another platform is rejected', async () => {
    const getSpy = spyOn(api, 'get').mockResolvedValue({
      id: 42,
      platform: 'android',
    });

    try {
      await expect(
        resolveAppId({ appId: '42', platform: 'ios' }),
      ).rejects.toThrow(/42.*android.*ios/);
    } finally {
      getSpy.mockRestore();
    }
  });

  test('a foreign or missing explicit appId fails before any work', async () => {
    const getSpy = spyOn(api, 'get').mockRejectedValue(
      new Error('403 Forbidden'),
    );

    try {
      await expect(
        resolveAppId({ appId: '42', platform: 'ios' }),
      ).rejects.toThrow('403');
    } finally {
      getSpy.mockRestore();
    }
  });

  test('a missing config is reported as app-not-selected', async () => {
    readFileSpy = spyOn(fs.promises, 'readFile').mockRejectedValue(enoent());

    await expect(resolveAppId({ platform: 'ios' })).rejects.toBeInstanceOf(
      AppNotSelectedError,
    );
  });

  test('a config without the platform is app-not-selected', async () => {
    readFileSpy = spyOn(fs.promises, 'readFile').mockResolvedValue(
      selection('android', 7),
    );

    await expect(resolveAppId({ platform: 'ios' })).rejects.toBeInstanceOf(
      AppNotSelectedError,
    );
  });

  test('a malformed config names the file that failed to parse', async () => {
    readFileSpy = spyOn(fs.promises, 'readFile').mockResolvedValue('{ oops');

    const error = await resolveAppId({
      platform: 'ios',
      config: 'configs/prod.json',
    }).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(AppNotSelectedError);
    expect((error as Error).message).toContain('configs/prod.json');
  });
});

describe('bundle target context', () => {
  let readFileSpy: Mock<typeof fs.promises.readFile>;
  let runBundleSpy: Mock<typeof bundleRunner.runReactNativeBundleCommand>;
  let publishSpy: Mock<typeof versionCommands.publish>;
  let addGitIgnoreSpy: Mock<typeof addGitIgnoreModule.addGitIgnore>;
  const restore: Array<{ mockRestore: () => void }> = [];

  beforeEach(() => {
    runBundleSpy = spyOn(
      bundleRunner,
      'runReactNativeBundleCommand',
    ).mockResolvedValue(undefined as any);
    publishSpy = spyOn(versionCommands, 'publish').mockResolvedValue('v1');
    addGitIgnoreSpy = spyOn(
      addGitIgnoreModule,
      'addGitIgnore',
    ).mockImplementation(() => {});
    restore.push(
      runBundleSpy,
      publishSpy,
      addGitIgnoreSpy,
      spyOn(checkLockfileModule, 'checkLockFiles').mockImplementation(() => {}),
      spyOn(utils, 'checkPlugins').mockResolvedValue({
        sentry: false,
        sourcemap: false,
      } as any),
      spyOn(hermesBaseModule, 'cleanStaleTmp').mockResolvedValue(undefined),
      spyOn(bundlePack, 'packBundle').mockResolvedValue(undefined as any),
      spyOn(console, 'log').mockImplementation(() => {}),
    );
  });

  afterEach(() => {
    readFileSpy?.mockRestore();
    for (const spy of restore.splice(0)) {
      spy.mockRestore();
    }
  });

  test('resolves the app once and reuses it for Hermes base and publish', async () => {
    readFileSpy = spyOn(fs.promises, 'readFile')
      .mockResolvedValueOnce(selection('ios', 42))
      .mockResolvedValueOnce(selection('ios', 99));

    await bundleCommands.bundle({
      options: {
        platform: 'ios',
        name: 'v1',
        config: 'configs/release.update.json',
      },
    });

    expect(readFileSpy).toHaveBeenCalledTimes(1);
    expect(readFileSpy).toHaveBeenCalledWith(
      'configs/release.update.json',
      'utf8',
    );
    expect(runBundleSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'ios',
        hermesBase: expect.objectContaining({ option: 'auto', appId: '42' }),
      }),
    );
    expect(publishSpy).toHaveBeenCalledTimes(1);
    const [request] = publishSpy.mock.calls[0];
    expect(request.options).toMatchObject({
      platform: 'ios',
      appId: '42',
      name: 'v1',
    });
    expect(request.options).not.toHaveProperty('config');
  });

  test('uses update.json when no config is given', async () => {
    readFileSpy = spyOn(fs.promises, 'readFile').mockResolvedValue(
      selection('android', 7),
    );

    await bundleCommands.bundle({
      options: { platform: 'android', name: 'v1' },
    });

    expect(readFileSpy).toHaveBeenCalledWith('update.json', 'utf8');
    expect(publishSpy.mock.calls[0][0].options).toMatchObject({
      appId: '7',
    });
  });

  test('an explicit appId skips the config and reaches publish', async () => {
    readFileSpy = spyOn(fs.promises, 'readFile').mockRejectedValue(enoent());
    restore.push(
      spyOn(api, 'get').mockResolvedValue({ id: 777, platform: 'ios' }),
    );

    await bundleCommands.bundle({
      options: { platform: 'ios', appId: '777', name: 'v1' },
    });

    expect(readFileSpy).not.toHaveBeenCalled();
    expect(runBundleSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        hermesBase: expect.objectContaining({ appId: '777' }),
      }),
    );
    expect(publishSpy.mock.calls[0][0].options).toMatchObject({
      appId: '777',
    });
  });

  test('a named bundle for an app of another platform fails before any work', async () => {
    restore.push(
      spyOn(api, 'get').mockResolvedValue({ id: 42, platform: 'android' }),
    );

    await expect(
      bundleCommands.bundle({
        options: { platform: 'ios', appId: '42', name: 'v3' },
      }),
    ).rejects.toThrow(/android/);

    expect(addGitIgnoreSpy).not.toHaveBeenCalled();
    expect(runBundleSpy).not.toHaveBeenCalled();
    expect(publishSpy).not.toHaveBeenCalled();
  });

  test('a named bundle without a selected app fails before any work', async () => {
    readFileSpy = spyOn(fs.promises, 'readFile').mockRejectedValue(enoent());

    await expect(
      bundleCommands.bundle({ options: { platform: 'ios', name: 'v1' } }),
    ).rejects.toBeInstanceOf(AppNotSelectedError);

    expect(addGitIgnoreSpy).not.toHaveBeenCalled();
    expect(runBundleSpy).not.toHaveBeenCalled();
    expect(publishSpy).not.toHaveBeenCalled();
  });

  test('a bundle-only run without a selected app still bundles', async () => {
    readFileSpy = spyOn(fs.promises, 'readFile').mockRejectedValue(enoent());

    await bundleCommands.bundle({
      options: { platform: 'ios', 'no-interactive': true },
    });

    expect(runBundleSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        hermesBase: expect.objectContaining({ option: 'auto' }),
      }),
    );
    expect(runBundleSpy.mock.calls[0][0].hermesBase?.appId).toBeUndefined();
    expect(publishSpy).not.toHaveBeenCalled();
  });

  test('a bundle-only run reports a malformed config before bundling', async () => {
    readFileSpy = spyOn(fs.promises, 'readFile').mockResolvedValue('{ oops');

    await expect(
      bundleCommands.bundle({
        options: { platform: 'ios', 'no-interactive': true },
      }),
    ).rejects.toThrow('update.json');

    expect(runBundleSpy).not.toHaveBeenCalled();
  });

  test('a dev bundle never needs the app', async () => {
    readFileSpy = spyOn(fs.promises, 'readFile').mockRejectedValue(
      new Error('config should not be read'),
    );

    await bundleCommands.bundle({
      options: { platform: 'ios', dev: true, 'no-interactive': true },
    });

    expect(readFileSpy).not.toHaveBeenCalled();
    expect(runBundleSpy.mock.calls[0][0].hermesBase).toBeUndefined();
  });
});

describe('app config target', () => {
  const restore: Array<{ mockRestore: () => void }> = [];

  afterEach(() => {
    for (const spy of restore.splice(0)) {
      spy.mockRestore();
    }
  });

  test('getSelectedApp reads the explicit config path', async () => {
    const readFileSpy = spyOn(fs.promises, 'readFile').mockResolvedValue(
      selection('ios', 42),
    );
    restore.push(readFileSpy);

    await expect(
      getSelectedApp('ios', 'configs/release.update.json'),
    ).resolves.toEqual({
      appId: '42',
      appKey: 'key-42',
      platform: 'ios',
    });
    expect(readFileSpy).toHaveBeenCalledWith(
      'configs/release.update.json',
      'utf8',
    );
  });

  test('createApp selects the new app in the explicit config file', async () => {
    const readFileSpy = spyOn(fs.promises, 'readFile').mockRejectedValue(
      enoent(),
    );
    const writeFileSpy = spyOn(fs.promises, 'writeFile').mockResolvedValue();
    restore.push(
      spyOn(api, 'post').mockResolvedValue({ id: 10 }),
      spyOn(api, 'get').mockResolvedValue({ appKey: 'key-ios-10' }),
      readFileSpy,
      writeFileSpy,
      spyOn(console, 'log').mockImplementation(() => {}),
    );

    await getAppCommands().createApp({
      options: {
        name: 'SmallWOD',
        downloadUrl: '',
        platform: 'ios',
        config: 'configs/release.update.json',
      },
    });

    expect(readFileSpy).toHaveBeenCalledWith(
      'configs/release.update.json',
      'utf8',
    );
    expect(writeFileSpy).toHaveBeenCalledWith(
      'configs/release.update.json',
      JSON.stringify({ ios: { appId: 10, appKey: 'key-ios-10' } }, null, 4),
      'utf8',
    );
  });
});
