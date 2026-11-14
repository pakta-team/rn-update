import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import * as api from '../src/api';
import { bundleCommands } from '../src/bundle';
import { packageCommands } from '../src/package';
import { CLIProviderImpl } from '../src/provider';
import * as versions from '../src/versions';

describe('CLIProviderImpl', () => {
  let provider: CLIProviderImpl;
  let consoleSpy: ReturnType<typeof spyOn>;
  let bundleSpy: ReturnType<typeof spyOn>;
  let publishSpy: ReturnType<typeof spyOn>;
  let updateSpy: ReturnType<typeof spyOn>;
  let uploadApkSpy: ReturnType<typeof spyOn>;
  let fetchVersionsSpy: ReturnType<typeof spyOn>;
  let apiGetSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    provider = new CLIProviderImpl();
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    bundleSpy?.mockRestore();
    publishSpy?.mockRestore();
    updateSpy?.mockRestore();
    uploadApkSpy?.mockRestore();
    fetchVersionsSpy?.mockRestore();
    apiGetSpy?.mockRestore();
  });

  describe('getPlatform', () => {
    test('resolves valid platform string', async () => {
      const platform = await provider.getPlatform('ios');
      expect(platform).toBe('ios');
    });

    test('resolves android platform', async () => {
      const platform = await provider.getPlatform('android');
      expect(platform).toBe('android');
    });

    test('resolves harmony platform', async () => {
      const platform = await provider.getPlatform('harmony');
      expect(platform).toBe('harmony');
    });

    test('throws for invalid platform', async () => {
      await expect(provider.getPlatform('windows' as any)).rejects.toThrow();
    });
  });

  test('bundle forwards resetCache and an explicit sourcemap opt-out', async () => {
    bundleSpy = spyOn(bundleCommands, 'bundle').mockResolvedValue(undefined);

    const result = await provider.bundle({
      platform: 'android',
      resetCache: false,
      sourcemap: false,
    });

    expect(result.success).toBe(true);
    expect(bundleSpy).toHaveBeenCalledWith({
      args: [],
      options: expect.objectContaining({
        platform: 'android',
        'no-interactive': true,
        resetCache: false,
        sourcemap: false,
      }),
    });
  });

  test('publish forwards file path and options to the publish command', async () => {
    publishSpy = spyOn(versions.versionCommands, 'publish').mockResolvedValue(
      'v1',
    );

    const result = await provider.publish({
      filePath: 'bundle.ppk',
      platform: 'ios',
      name: 'v1',
      rollout: 50,
    });

    expect(result.success).toBe(true);
    expect(publishSpy).toHaveBeenCalledWith({
      args: ['bundle.ppk'],
      options: expect.objectContaining({
        platform: 'ios',
        name: 'v1',
        'no-interactive': true,
        rollout: '50',
      }),
    });
  });

  test('publish forwards appId and config so callers can target an app explicitly', async () => {
    publishSpy = spyOn(versions.versionCommands, 'publish').mockResolvedValue(
      'v1',
    );

    const result = await provider.publish({
      filePath: 'bundle.ppk',
      platform: 'android',
      appId: '42',
      config: 'custom-update.json',
    });

    expect(result.success).toBe(true);
    expect(publishSpy).toHaveBeenCalledWith({
      args: ['bundle.ppk'],
      options: expect.objectContaining({
        appId: '42',
        config: 'custom-update.json',
      }),
    });
  });

  test('updateVersion passes appId and versionId as command options', async () => {
    updateSpy = spyOn(versions.versionCommands, 'update').mockResolvedValue(
      undefined,
    );

    const result = await provider.updateVersion('100', '200', {
      packageId: '300',
      rollout: 25,
    });

    expect(result.success).toBe(true);
    expect(updateSpy).toHaveBeenCalledWith({
      args: [],
      options: expect.objectContaining({
        appId: '100',
        versionId: '200',
        packageId: '300',
        'no-interactive': true,
        rollout: '25',
      }),
    });
  });

  test('upload forwards explicit app identity to package commands', async () => {
    uploadApkSpy = spyOn(packageCommands, 'uploadApk').mockResolvedValue(
      undefined,
    );

    const result = await provider.upload({
      filePath: 'app.apk',
      appId: '100',
      appKey: 'key',
      version: '1.0.0',
    });

    expect(result.success).toBe(true);
    expect(uploadApkSpy).toHaveBeenCalledWith({
      args: ['app.apk'],
      options: expect.objectContaining({
        appId: '100',
        appKey: 'key',
        version: '1.0.0',
      }),
    });
  });

  test('listVersions returns fetched data without entering interactive mode', async () => {
    fetchVersionsSpy = spyOn(versions, 'fetchVersions').mockResolvedValue([
      { id: '200', hash: 'abcdef123', name: 'v1' },
    ]);

    const result = await provider.listVersions('100');

    expect(result).toEqual({
      success: true,
      data: [{ id: '200', hash: 'abcdef123', name: 'v1' }],
    });
    expect(fetchVersionsSpy).toHaveBeenCalledWith('100');
  });

  test('listApps returns fetched app data', async () => {
    apiGetSpy = spyOn(api, 'get').mockResolvedValue({
      data: [{ id: 100, name: 'Demo', platform: 'ios' }],
    });

    const result = await provider.listApps();

    expect(result).toEqual({
      success: true,
      data: [{ id: 100, name: 'Demo', platform: 'ios' }],
    });
    expect(apiGetSpy).toHaveBeenCalledWith('/app/list');
  });
});
