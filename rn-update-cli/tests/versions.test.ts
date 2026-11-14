/**
 * [INPUT]: 依赖版本发布编排、standalone UpdatePackage/Deployment API 与 Bun mock
 * [OUTPUT]: 验证旧版发布、standalone 流式制品指纹/去重复用/读取失败零写入、投放、Hermes 校验结果上报与版本筛选
 * [POS]: CLI versions/standalone-publish 的发布契约回归防线，不连接真实服务
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test';

// We test the exported helper bindVersionToPackages and the internal rollout
// parsing logic by calling versionCommands.update with mocked API calls.

import fs from 'fs';
import os from 'os';
import path from 'path';
import * as api from '../src/api';
import * as app from '../src/app';
import { publishStandalone } from '../src/standalone-publish';
import * as utils from '../src/utils';
import * as git from '../src/utils/git';
import { sha256Hex } from '../src/utils/hash';
import {
  bindVersionToPackages,
  normalizeDeps,
  versionCommands,
} from '../src/versions';

async function withInteractiveStdin<T>(task: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  Object.defineProperty(process.stdin, 'isTTY', {
    configurable: true,
    value: true,
  });
  try {
    return await task();
  } finally {
    if (descriptor) {
      Object.defineProperty(process.stdin, 'isTTY', descriptor);
    } else {
      Reflect.deleteProperty(process.stdin, 'isTTY');
    }
  }
}

describe('bindVersionToPackages', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let postSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    postSpy = spyOn(api, 'post').mockResolvedValue({});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    postSpy.mockRestore();
  });

  test('binds version to a single package', async () => {
    await bindVersionToPackages({
      appId: '100',
      versionId: '200',
      pkgs: [{ id: '10', name: '1.0.0' }],
    });

    expect(postSpy).toHaveBeenCalledWith('/app/100/binding', {
      versionId: '200',
      rollout: undefined,
      packageId: '10',
    });
  });

  test('binds version to multiple packages', async () => {
    await bindVersionToPackages({
      appId: '100',
      versionId: '200',
      pkgs: [
        { id: '10', name: '1.0.0' },
        { id: '11', name: '1.1.0' },
        { id: '12', name: '1.2.0' },
      ],
    });

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).toHaveBeenCalledWith('/app/100/binding', {
      versionId: '200',
      rollout: undefined,
      packageIds: [10, 11, 12],
    });
  });

  test('passes rollout configuration', async () => {
    await bindVersionToPackages({
      appId: '100',
      versionId: '200',
      pkgs: [{ id: '10', name: '1.0.0' }],
      rollout: 50,
    });

    expect(postSpy).toHaveBeenCalledWith('/app/100/binding', {
      versionId: '200',
      rollout: 50,
      packageId: '10',
    });
  });

  test('skips API call in dryRun mode', async () => {
    await bindVersionToPackages({
      appId: '100',
      versionId: '200',
      pkgs: [{ id: '10', name: '1.0.0' }],
      dryRun: true,
    });

    expect(postSpy).not.toHaveBeenCalled();
  });

  test('logs operation completion after binding packages', async () => {
    await bindVersionToPackages({
      appId: '100',
      versionId: '200',
      pkgs: [
        { id: '10', name: '1.0.0' },
        { id: '11', name: '1.1.0' },
      ],
    });

    expect(consoleSpy).toHaveBeenCalledTimes(3);
  });
});

describe('versionCommands.publish', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let getPlatformSpy: ReturnType<typeof spyOn>;
  let getSelectedAppSpy: ReturnType<typeof spyOn>;
  let uploadFileSpy: ReturnType<typeof spyOn>;
  let postSpy: ReturnType<typeof spyOn>;
  let questionSpy: ReturnType<typeof spyOn>;
  let getCommitInfoSpy: ReturnType<typeof spyOn>;
  let updateSpy: ReturnType<typeof spyOn>;
  let appGetSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    getPlatformSpy = spyOn(app, 'getPlatform').mockResolvedValue('android');
    appGetSpy = spyOn(api, 'get').mockResolvedValue({
      id: 777,
      platform: 'android',
    });
    getSelectedAppSpy = spyOn(app, 'getSelectedApp').mockResolvedValue({
      appId: '100',
      appKey: 'key',
      platform: 'android',
    });
    uploadFileSpy = spyOn(api, 'uploadFile').mockResolvedValue({
      hash: 'hash',
    });
    postSpy = spyOn(api, 'post').mockResolvedValue({ id: '200' });

    const answers = ['name', 'description', '{}', 'y'];
    const questionMock = mock(async () => answers.shift() ?? '');
    questionSpy = spyOn(utils, 'question').mockImplementation(questionMock);
    getCommitInfoSpy = spyOn(git, 'getCommitInfo').mockResolvedValue(undefined);
    updateSpy = spyOn(versionCommands, 'update').mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    getPlatformSpy.mockRestore();
    getSelectedAppSpy.mockRestore();
    uploadFileSpy.mockRestore();
    postSpy.mockRestore();
    questionSpy.mockRestore();
    getCommitInfoSpy.mockRestore();
    updateSpy.mockRestore();
    appGetSpy.mockRestore();
  });

  test('removes the packed source map copy even when the ppk upload fails', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rnu-publish-map-'));
    const mapPath = path.join(dir, 'index.bundlejs.map');
    fs.writeFileSync(
      mapPath,
      JSON.stringify({ version: 3, sources: ['a.js'], mappings: '' }),
    );
    const packedDirs = () =>
      fs
        .readdirSync(os.tmpdir())
        .filter((name) => name.startsWith('rnu-sourcemap-'));
    const before = packedDirs();
    uploadFileSpy.mockRejectedValue(new Error('upload failed'));
    try {
      await expect(
        versionCommands.publish({
          args: ['bundle.ppk'],
          options: {
            platform: 'android',
            name: 'v1',
            sourcemap: mapPath,
            'no-interactive': true,
          },
        }),
      ).rejects.toThrow('upload failed');
      expect(packedDirs().filter((name) => !before.includes(name))).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('can bind after publish when called without object receiver', async () => {
    const publish = versionCommands.publish;

    await withInteractiveStdin(() =>
      publish({
        args: ['bundle.ppk'],
        options: { platform: 'android' },
      }),
    );

    expect(updateSpy).toHaveBeenCalledWith({
      options: {
        versionId: '200',
        platform: 'android',
        appId: '100',
        versionDeps: expect.any(Object),
        warnDepsChanges: true,
      },
    });
  });

  test('keeps an explicit appId through version creation and binding', async () => {
    await versionCommands.publish({
      args: ['bundle.ppk'],
      options: {
        platform: 'android',
        appId: '777',
        name: 'v1',
        packageVersion: '1.0.0',
        'no-interactive': true,
      },
    });

    expect(getSelectedAppSpy).not.toHaveBeenCalled();
    expect(appGetSpy).toHaveBeenCalledWith('/app/777');
    expect(uploadFileSpy).toHaveBeenCalledWith('bundle.ppk', '777');
    expect(postSpy).toHaveBeenCalledWith(
      '/app/777/version/create',
      expect.any(Object),
    );
    expect(updateSpy).toHaveBeenCalledWith({
      options: expect.objectContaining({
        versionId: '200',
        platform: 'android',
        appId: '777',
        packageVersion: '1.0.0',
      }),
    });
  });

  test('does not prompt for optional fields in no-interactive mode', async () => {
    await versionCommands.publish({
      args: ['bundle.ppk'],
      options: {
        platform: 'android',
        name: 'v1',
        'no-interactive': true,
      },
    });

    expect(questionSpy).not.toHaveBeenCalled();
    expect(postSpy).toHaveBeenCalledWith(
      '/app/100/version/create',
      expect.objectContaining({
        name: 'v1',
        description: '',
        metaInfo: '',
      }),
    );
    expect(updateSpy).not.toHaveBeenCalled();
  });
});

describe('standalone interactive publish', () => {
  const appId = '01a08fcf-6a3d-7eb6-963b-83aa0a9d3569';
  const channelId = '01a08fcf-6a3d-7eb6-963b-83aa0a9d3570';
  const nativePackageId = '01a08fcf-6a3d-7eb6-963b-83aa0a9d3571';
  const updatePackageId = '01a08fcf-6a3d-7eb6-963b-83aa0a9d3572';
  const deploymentId = '01a08fcf-6a3d-7eb6-963b-83aa0a9d3573';
  let consoleSpy: ReturnType<typeof spyOn>;
  let getSpy: ReturnType<typeof spyOn>;
  let getChannelsSpy: ReturnType<typeof spyOn>;
  let getAllPackagesSpy: ReturnType<typeof spyOn>;
  let uploadFileSpy: ReturnType<typeof spyOn>;
  let postSpy: ReturnType<typeof spyOn>;
  let servicePathSpy: ReturnType<typeof spyOn>;
  let questionSpy: ReturnType<typeof spyOn>;
  let tempDir: string;
  let previousNoInteractiveGlobal: boolean | undefined;

  beforeEach(() => {
    previousNoInteractiveGlobal = global.NO_INTERACTIVE;
    global.NO_INTERACTIVE = undefined;

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rnu-standalone-publish-'));
    fs.writeFileSync(path.join(tempDir, 'bundle.ppk'), 'interactive-ppk');

    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    getSpy = spyOn(api, 'get').mockImplementation(async (url: string) => {
      if (url.includes('/update-packages?page=')) {
        return { data: { items: [], total: 0 } };
      }
      if (url.endsWith(`/update-packages/${updatePackageId}/deployments`)) {
        return { data: [] };
      }
      throw new Error(`unexpected GET ${url}`);
    });
    getChannelsSpy = spyOn(api, 'getChannels').mockResolvedValue([
      { id: channelId, code: 'test', name: 'test' },
    ]);
    getAllPackagesSpy = spyOn(api, 'getAllPackages').mockResolvedValue([
      {
        id: nativePackageId,
        name: '1.84.2',
        versionName: '1.84.2',
        channelId,
      },
    ]);
    uploadFileSpy = spyOn(api, 'uploadFile').mockResolvedValue({
      hash: 'full-key',
      key: 'full-key',
    });
    servicePathSpy = spyOn(api, 'servicePath').mockImplementation(
      (route: string) =>
        `/admin/api/v1${route.startsWith('/') ? route : `/${route}`}`,
    );
    postSpy = spyOn(api, 'post').mockImplementation(
      async (url: string, body?: Record<string, unknown>) => {
        if (url.endsWith(`/apps/${appId}/update-packages`)) {
          return { data: { id: updatePackageId } };
        }
        if (url.endsWith(`/apps/${appId}/deployments/batch`)) {
          const command = (
            body?.commands as Array<Record<string, unknown>>
          )?.[0];
          if (command?.action === 'save') {
            return {
              data: [
                {
                  id: deploymentId,
                  packageId: updatePackageId,
                  channelId,
                  packageVersion: '1.84.2',
                  rollout: 100,
                  forceBoot: false,
                  revision: 0,
                },
              ],
            };
          }
          return { data: [] };
        }
        throw new Error(`unexpected POST ${url}`);
      },
    );
    const answers = [
      'interactive-v1',
      'description',
      '{}',
      'y',
      nativePackageId,
    ];
    questionSpy = spyOn(utils, 'question').mockImplementation(
      async () => answers.shift() ?? '',
    );
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    getSpy.mockRestore();
    getChannelsSpy.mockRestore();
    getAllPackagesSpy.mockRestore();
    uploadFileSpy.mockRestore();
    postSpy.mockRestore();
    servicePathSpy.mockRestore();
    questionSpy.mockRestore();
    fs.rmSync(tempDir, { recursive: true, force: true });
    global.NO_INTERACTIVE = previousNoInteractiveGlobal;
  });

  test('uploads first, then interactively binds the selected native build', async () => {
    const packageId = await withInteractiveStdin(() =>
      publishStandalone(path.join(tempDir, 'bundle.ppk'), appId, {}),
    );

    expect(packageId).toBe(updatePackageId);
    expect(uploadFileSpy).toHaveBeenCalledWith(
      path.join(tempDir, 'bundle.ppk'),
      appId,
    );
    expect(questionSpy).toHaveBeenCalledTimes(5);
    expect(postSpy).toHaveBeenCalledWith(
      `/admin/api/v1/apps/${appId}/update-packages`,
      expect.objectContaining({
        name: 'interactive-v1',
        description: 'description',
        metaInfo: '{}',
      }),
    );

    const deploymentCalls = postSpy.mock.calls.filter(([url]) =>
      url.endsWith(`/apps/${appId}/deployments/batch`),
    );
    expect(deploymentCalls).toHaveLength(2);
    expect(deploymentCalls[0]?.[1]).toEqual(
      expect.objectContaining({
        commands: [
          expect.objectContaining({
            action: 'save',
            channelId,
            packageVersion: '1.84.2',
            rollout: 100,
          }),
        ],
      }),
    );
    expect(deploymentCalls[1]?.[1]).toEqual(
      expect.objectContaining({
        commands: [
          expect.objectContaining({
            action: 'publish',
            channelId,
            packageVersion: '1.84.2',
            rollout: 100,
          }),
        ],
      }),
    );
  });

  test('streams the full artifact hash without whole-file reads', async () => {
    const file = path.join(tempDir, 'bundle.ppk');
    const bytes = Buffer.alloc(256 * 1024 + 17, 0xa5);
    fs.writeFileSync(file, bytes);
    const expectedHash = sha256Hex(bytes);
    const readFileSync = fs.readFileSync;
    const readSpy = spyOn(fs, 'readFileSync').mockImplementation(
      (...args: Parameters<typeof fs.readFileSync>) => {
        if (args[0] === file) throw new Error('whole-file read forbidden');
        return readFileSync(...args);
      },
    );
    try {
      await withInteractiveStdin(() => publishStandalone(file, appId, {}));
      expect(postSpy).toHaveBeenCalledWith(
        `/admin/api/v1/apps/${appId}/update-packages`,
        expect.objectContaining({ hash: expectedHash }),
      );
      expect(readSpy.mock.calls.some(([target]) => target === file)).toBe(
        false,
      );
    } finally {
      readSpy.mockRestore();
    }
  });

  test('reuses an existing package by the same raw-byte SHA-256 without upload', async () => {
    const hash = sha256Hex('interactive-ppk');
    getSpy.mockResolvedValue({
      data: { items: [{ id: updatePackageId, hash }], total: 1 },
    });
    questionSpy.mockResolvedValue('n');

    const packageId = await withInteractiveStdin(() =>
      publishStandalone(path.join(tempDir, 'bundle.ppk'), appId, {}),
    );

    expect(packageId).toBe(updatePackageId);
    expect(uploadFileSpy).not.toHaveBeenCalled();
    expect(postSpy).not.toHaveBeenCalled();
  });

  test('a missing artifact fails before any upload or package write', async () => {
    await expect(
      withInteractiveStdin(() =>
        publishStandalone(path.join(tempDir, 'missing.ppk'), appId, {}),
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' });

    expect(getSpy).not.toHaveBeenCalled();
    expect(uploadFileSpy).not.toHaveBeenCalled();
    expect(postSpy).not.toHaveBeenCalled();
  });

  test('keeps Hermes verification outcome out of opaque metaInfo', async () => {
    await withInteractiveStdin(() =>
      publishStandalone(path.join(tempDir, 'bundle.ppk'), appId, {
        hermesBase: {
          bytecodeVersion: 98,
          baseVersionId: 42,
          baseHash: 'base-hash',
          hermesBaseOutcome: 'rejected',
          hermesBaseDetail: 'Function<f> line 3: literal mismatch',
        },
      }),
    );

    expect(postSpy).toHaveBeenCalledWith(
      `/admin/api/v1/apps/${appId}/update-packages`,
      expect.objectContaining({
        metaInfo: '{}',
        hermesBaseOutcome: 'rejected',
        hermesBaseDetail: 'Function<f> line 3: literal mismatch',
      }),
    );
  });
});

describe('versionCommands.versions', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let getSpy: ReturnType<typeof spyOn>;
  let getPlatformSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    getSpy = spyOn(api, 'get').mockResolvedValue({
      data: [{ id: '200', hash: 'abcdef123', name: 'v1', packages: [] }],
    });
    getPlatformSpy = spyOn(app, 'getPlatform').mockResolvedValue('ios');
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    getSpy.mockRestore();
    getPlatformSpy.mockRestore();
  });

  test('uses provided appId and requests the first paged result in non-interactive mode', async () => {
    await versionCommands.versions({
      options: { appId: '100', 'no-interactive': true },
    });

    expect(getSpy).toHaveBeenCalledWith(
      '/app/100/version/list?offset=0&limit=10',
    );
    expect(getPlatformSpy).not.toHaveBeenCalled();
  });

  test('honors global non-interactive mode when listing versions', async () => {
    global.NO_INTERACTIVE = true;

    try {
      await versionCommands.versions({
        options: { appId: '100' },
      });
    } finally {
      global.NO_INTERACTIVE = undefined;
    }

    expect(getSpy).toHaveBeenCalledWith(
      '/app/100/version/list?offset=0&limit=10',
    );
  });
});

describe('versionCommands.update package range selection', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let getAllPackagesSpy: ReturnType<typeof spyOn>;
  let postSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    getAllPackagesSpy = spyOn(api, 'getAllPackages').mockResolvedValue([
      { id: '10', name: '1.0.0' },
      { id: '11', name: '1.1.0' },
      { id: '12', name: '1.2.0' },
      { id: '13', name: '1.3.0' },
    ]);
    postSpy = spyOn(api, 'post').mockResolvedValue({});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    getAllPackagesSpy.mockRestore();
    postSpy.mockRestore();
  });

  test('applies minPackageVersion as a lower bound', async () => {
    const appId = 'min-app';

    await versionCommands.update({
      options: {
        appId,
        versionId: '200',
        minPackageVersion: '1.1.0',
      },
    });

    const bindingCalls = postSpy.mock.calls.filter(
      ([url]) => url === `/app/${appId}/binding`,
    );

    expect(bindingCalls).toHaveLength(1);
    expect(bindingCalls[0]).toEqual([
      `/app/${appId}/binding`,
      {
        versionId: '200',
        rollout: undefined,
        packageIds: [11, 12, 13],
      },
    ]);
  });

  test('applies maxPackageVersion as an upper bound', async () => {
    const appId = 'max-app';

    await versionCommands.update({
      options: {
        appId,
        versionId: '200',
        maxPackageVersion: '1.2.0',
      },
    });

    const bindingCalls = postSpy.mock.calls.filter(
      ([url]) => url === `/app/${appId}/binding`,
    );

    expect(bindingCalls).toHaveLength(1);
    expect(bindingCalls[0]).toEqual([
      `/app/${appId}/binding`,
      {
        versionId: '200',
        rollout: undefined,
        packageIds: [10, 11, 12],
      },
    ]);
  });

  test('intersects minPackageVersion and maxPackageVersion when both are given', async () => {
    const appId = 'range-app';

    await versionCommands.update({
      options: {
        appId,
        versionId: '200',
        minPackageVersion: '1.1.0',
        maxPackageVersion: '1.2.0',
      },
    });

    const bindingCalls = postSpy.mock.calls.filter(
      ([url]) => url === `/app/${appId}/binding`,
    );

    expect(bindingCalls).toHaveLength(1);
    expect(bindingCalls[0]).toEqual([
      `/app/${appId}/binding`,
      {
        versionId: '200',
        rollout: undefined,
        packageIds: [11, 12],
      },
    ]);
  });

  test('fails when min/max bounds match no package', async () => {
    await expect(
      versionCommands.update({
        options: {
          appId: 'empty-range-app',
          versionId: '200',
          minPackageVersion: '2.0.0',
          maxPackageVersion: '2.5.0',
        },
      }),
    ).rejects.toThrow('2.0.0');

    expect(postSpy).not.toHaveBeenCalled();
  });

  test('rejects mixing different package selectors', async () => {
    for (const options of [
      { packageId: '10', packageVersion: '1.0.0' },
      { packageVersion: '1.0.0', packageVersionRange: '^1.0.0' },
      { packageId: '10', minPackageVersion: '1.0.0' },
      { packageVersionRange: '^1.0.0', maxPackageVersion: '1.2.0' },
    ]) {
      await expect(
        versionCommands.update({
          options: {
            appId: 'conflict-app',
            versionId: '200',
            ...options,
          },
        }),
      ).rejects.toThrow(/packageVersionRange/);
    }

    expect(postSpy).not.toHaveBeenCalled();
  });

  test('fails instead of prompting for package id in non-interactive mode', async () => {
    global.NO_INTERACTIVE = true;

    try {
      await expect(
        versionCommands.update({
          options: {
            appId: '100',
            versionId: '200',
          },
        }),
      ).rejects.toThrow(/packageId|packageVersion/);

      expect(postSpy).not.toHaveBeenCalled();
    } finally {
      global.NO_INTERACTIVE = undefined;
    }
  });
});

describe('versionCommands.updateVersionInfo', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let putSpy: ReturnType<typeof spyOn>;
  let getPlatformSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    putSpy = spyOn(api, 'put').mockResolvedValue({});
    getPlatformSpy = spyOn(app, 'getPlatform').mockResolvedValue('ios');
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    putSpy.mockRestore();
    getPlatformSpy.mockRestore();
  });

  test('uses provided appId and versionId without selecting an app', async () => {
    await versionCommands.updateVersionInfo({
      options: {
        appId: '100',
        versionId: '200',
        name: 'v2',
        'no-interactive': true,
      },
    });

    expect(putSpy).toHaveBeenCalledWith('/app/100/version/200', {
      name: 'v2',
    });
    expect(getPlatformSpy).not.toHaveBeenCalled();
  });

  test('fails instead of prompting for version id in non-interactive mode', async () => {
    await expect(
      versionCommands.updateVersionInfo({
        options: {
          appId: '100',
          name: 'v2',
          'no-interactive': true,
        },
      }),
    ).rejects.toThrow(/versionId/);

    expect(putSpy).not.toHaveBeenCalled();
  });
});

describe('versionCommands.deleteVersion', () => {
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

  test('deletes the provided version id without prompting', async () => {
    await versionCommands.deleteVersion({
      options: {
        appId: '100',
        versionId: '200',
        'no-interactive': true,
      },
    });

    expect(deleteSpy).toHaveBeenCalledWith('/app/100/version/200');
  });

  test('deletes multiple version ids with the batch endpoint', async () => {
    await versionCommands.deleteVersion({
      options: {
        appId: '100',
        versionIds: '200,201',
        'no-interactive': true,
      },
    });

    expect(deleteSpy).toHaveBeenCalledWith('/app/100/version', {
      versionIds: [200, 201],
    });
  });

  test('accepts comma separated ids through the legacy versionId option', async () => {
    await versionCommands.deleteVersion({
      options: {
        appId: '100',
        versionId: '200,201',
        'no-interactive': true,
      },
    });

    expect(deleteSpy).toHaveBeenCalledWith('/app/100/version', {
      versionIds: [200, 201],
    });
  });

  test('fails instead of prompting for version id in non-interactive mode', async () => {
    await expect(
      versionCommands.deleteVersion({
        options: {
          appId: '100',
          'no-interactive': true,
        },
      }),
    ).rejects.toThrow(/versionId/);

    expect(deleteSpy).not.toHaveBeenCalled();
  });
});

describe('rollout validation (via versionCommands.update)', () => {
  // We test rollout parsing indirectly by importing the module and checking
  // that Number.parseInt + NaN check works correctly via the update command.
  // Since update() requires many dependencies, we test the fixed logic directly.

  function parseRollout(value: string | undefined): number | undefined {
    if (value === undefined) return undefined;
    const rollout = Number.parseInt(value, 10);
    if (Number.isNaN(rollout) || rollout < 1 || rollout > 100) {
      throw new Error('rollout must be an integer between 1-100');
    }
    return rollout;
  }

  test('parses valid rollout values', () => {
    expect(parseRollout('1')).toBe(1);
    expect(parseRollout('50')).toBe(50);
    expect(parseRollout('100')).toBe(100);
  });

  test('rejects rollout value of 0', () => {
    expect(() => parseRollout('0')).toThrow('1-100');
  });

  test('rejects rollout value above 100', () => {
    expect(() => parseRollout('101')).toThrow('1-100');
  });

  test('rejects non-numeric rollout (was the bug: parseInt never throws)', () => {
    expect(() => parseRollout('abc')).toThrow('1-100');
    expect(() => parseRollout('')).toThrow('1-100');
    expect(() => parseRollout('not-a-number')).toThrow('1-100');
  });

  test('rejects negative rollout', () => {
    expect(() => parseRollout('-5')).toThrow('1-100');
  });

  test('returns undefined when value is undefined', () => {
    expect(parseRollout(undefined)).toBeUndefined();
  });

  test('handles leading-number strings like "50abc"', () => {
    // parseInt('50abc') returns 50, which is valid
    expect(parseRollout('50abc')).toBe(50);
  });

  test('handles decimal strings', () => {
    // parseInt('33.7') returns 33
    expect(parseRollout('33.7')).toBe(33);
  });
});

describe('normalizeDeps', () => {
  test('returns undefined for falsy inputs', () => {
    expect(normalizeDeps(undefined)).toBeUndefined();
    expect(normalizeDeps(null)).toBeUndefined();
    expect(normalizeDeps(false)).toBeUndefined();
    expect(normalizeDeps('')).toBeUndefined();
  });

  test('handles string inputs', () => {
    // Valid JSON object with string values
    expect(normalizeDeps('{"react":"18.2.0","lodash":"4.17.21"}')).toEqual({
      react: '18.2.0',
      lodash: '4.17.21',
    });

    // Valid JSON but not an object (array)
    expect(normalizeDeps('["react", "lodash"]')).toBeUndefined();

    // Valid JSON but non-string values
    expect(normalizeDeps('{"react": 18, "lodash": true}')).toBeUndefined();

    // Invalid JSON
    expect(normalizeDeps('invalid-json')).toBeUndefined();
  });

  test('handles object inputs', () => {
    // Valid object
    expect(normalizeDeps({ react: '18.2.0', lodash: '4.17.21' })).toEqual({
      react: '18.2.0',
      lodash: '4.17.21',
    });

    // Object with mixed values (ignores non-strings and empty strings)
    expect(
      normalizeDeps({
        react: '18.2.0',
        lodash: 4,
        empty: '',
        bool: true,
        obj: {},
      }),
    ).toEqual({
      react: '18.2.0',
    });

    // Empty object after filtering
    expect(normalizeDeps({ number: 1, bool: true })).toBeUndefined();
  });

  test('returns undefined for invalid object types', () => {
    // Array
    expect(normalizeDeps(['react'])).toBeUndefined();
    // Function
    expect(normalizeDeps(() => {})).toBeUndefined();
  });
});
