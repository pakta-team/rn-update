/**
 * [INPUT]: 依赖独立发布/重试编排、CLI API 替身、临时制品与历史渠道夹具
 * [OUTPUT]: 验证渠道精确身份和整批预检、逐目标 CAS、幂等重试/冲突透传及 dry-run 零写入
 * [POS]: CLI 到独立服务的命令契约回归，与真实 PostgreSQL CAS 测试分层验收
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as api from '../src/api';
import {
  publishStandalone,
  retryStandalonePublish,
} from '../src/standalone-publish';

describe('standalone channel identity preflight', () => {
  const channels = [
    { id: 'upper', code: 'Beta', name: 'Beta' },
    { id: 'lower', code: 'beta', name: 'beta' },
  ];
  let root = '';
  const spies: Array<ReturnType<typeof spyOn>> = [];

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-channel-'));
  });

  afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test.each([
    ['Beta', channels, 'upper'],
    ['beta', channels, 'lower'],
    ['BETA', [channels[0]], 'upper'],
    ['beta', [channels[0]], 'upper'],
  ] as const)(
    'dry-run resolves %s to its intended historical identity',
    async (code, registered, id) => {
      spies.push(spyOn(api, 'getChannels').mockResolvedValue([...registered]));
      const log = spyOn(console, 'log').mockImplementation(() => {});
      spies.push(log);
      await publishStandalone('unused.ppk', 'app-1', {
        channel: code,
        packageVersion: '1.0',
        dryRun: true,
      });
      expect(JSON.parse(log.mock.calls[0][0]).targets[0].channelId).toBe(id);
    },
  );

  test.each(['Beta', 'beta'])(
    'real publish submits exact historical %s target without creating channels',
    async (code) => {
      const id = code === 'Beta' ? 'upper' : 'lower';
      const file = path.join(root, 'update.ppk');
      fs.writeFileSync(file, 'artifact');
      spies.push(spyOn(api, 'getChannels').mockResolvedValue(channels));
      const create = spyOn(api, 'createChannel').mockRejectedValue(
        new Error('unexpected creation'),
      );
      const upload = spyOn(api, 'uploadFile').mockResolvedValue({
        hash: 'artifact-key',
      });
      spies.push(
        create,
        upload,
        spyOn(console, 'log').mockImplementation(() => {}),
      );
      spies.push(
        spyOn(api, 'get').mockImplementation(async (url: string) =>
          url.includes('/update-packages?')
            ? { data: { items: [] } }
            : { data: [] },
        ),
      );
      const post = spyOn(api, 'post').mockImplementation(
        async (url: string, body?: Record<string, any>) => {
          if (url.endsWith('/update-packages'))
            return { data: { id: 'package-1' } };
          const command = body?.commands[0];
          expect(command.channelId).toBe(id);
          return { data: [{ ...command, id: 'deployment-1', revision: 1 }] };
        },
      );
      spies.push(post);
      await publishStandalone(file, 'app-1', {
        channel: code,
        packageVersion: '1.0',
        name: 'release',
        description: '',
        metaInfo: '',
        'no-interactive': true,
      });
      expect(create).not.toHaveBeenCalled();
      expect(upload).toHaveBeenCalledTimes(1);
      expect(post).toHaveBeenCalledTimes(3);
    },
  );

  test('explicit channelId disambiguates historical channels', async () => {
    spies.push(spyOn(api, 'getChannels').mockResolvedValue(channels));
    const log = spyOn(console, 'log').mockImplementation(() => {});
    spies.push(log);
    const targets = path.join(root, 'targets.json');
    fs.writeFileSync(
      targets,
      JSON.stringify([
        { channelId: 'upper', channel: 'BETA', packageVersion: '1.0' },
      ]),
    );
    await publishStandalone('unused.ppk', 'app-1', { targets, dryRun: true });
    expect(JSON.parse(log.mock.calls[0][0]).targets[0].channelId).toBe('upper');
  });

  test.each([false, true])(
    'ambiguous later target rejects the entire batch before writes (dryRun=%s)',
    async (dryRun) => {
      spies.push(spyOn(api, 'getChannels').mockResolvedValue(channels));
      const create = spyOn(api, 'createChannel').mockResolvedValue({
        id: 'new',
        code: 'new',
        name: 'new',
      });
      const post = spyOn(api, 'post').mockResolvedValue({});
      const upload = spyOn(api, 'uploadFile').mockResolvedValue({
        hash: 'unused',
      });
      spies.push(create, post, upload);
      const targets = path.join(root, 'targets.json');
      fs.writeFileSync(
        targets,
        JSON.stringify([
          { channel: dryRun ? 'Beta' : 'new', packageVersion: '1.0' },
          { channel: 'BETA', packageVersion: '1.0' },
        ]),
      );
      await expect(
        publishStandalone('unused.ppk', 'app-1', { targets, dryRun }),
      ).rejects.toThrow();
      expect(create).not.toHaveBeenCalled();
      expect(post).not.toHaveBeenCalled();
      expect(upload).not.toHaveBeenCalled();
    },
  );
});

describe('retryStandalonePublish', () => {
  const appId = '01a08fcf-6a3d-7eb6-963b-83aa0a9d3569';
  const packageId = '01a08fcf-6a3d-7eb6-963b-83aa0a9d3572';
  const deployments = [
    {
      id: '01a08fcf-6a3d-7eb6-963b-83aa0a9d3573',
      applicationId: appId,
      packageId,
      channelId: '01a08fcf-6a3d-7eb6-963b-83aa0a9d3570',
      packageVersion: '1.84.2',
      rollout: 25,
      forceBoot: false,
      revision: 3,
    },
    {
      id: '01a08fcf-6a3d-7eb6-963b-83aa0a9d3574',
      applicationId: appId,
      packageId,
      channelId: '01a08fcf-6a3d-7eb6-963b-83aa0a9d3575',
      packageVersion: '1.85.0',
      rollout: 100,
      forceBoot: true,
      revision: 7,
    },
  ];
  const deploymentIds = deployments.map(({ id }) => id);
  const input = ` ${deploymentIds[0]}, , ${deploymentIds[1]} `;
  const expectedCommands = deployments.map(
    ({ applicationId: _, revision, ...deployment }) => ({
      ...deployment,
      expectedRevision: revision,
      action: 'publish',
    }),
  );
  let getSpy: ReturnType<typeof spyOn>;
  let postSpy: ReturnType<typeof spyOn>;
  let putSpy: ReturnType<typeof spyOn>;
  let deleteSpy: ReturnType<typeof spyOn>;
  let uploadSpy: ReturnType<typeof spyOn>;
  let consoleSpy: ReturnType<typeof spyOn>;
  let servicePathSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    getSpy = spyOn(api, 'get').mockImplementation(async (url: string) => {
      const deployment = deployments.find(({ id }) =>
        url.endsWith(`/deployments/${id}`),
      );
      if (!deployment) throw new Error(`unexpected GET ${url}`);
      return { data: { ...deployment } };
    });
    postSpy = spyOn(api, 'post').mockResolvedValue({ data: [] });
    putSpy = spyOn(api, 'put').mockResolvedValue({});
    deleteSpy = spyOn(api, 'doDelete').mockResolvedValue({});
    uploadSpy = spyOn(api, 'uploadFile').mockResolvedValue({ hash: 'unused' });
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    servicePathSpy = spyOn(api, 'servicePath').mockImplementation(
      (route: string) => `/admin/api/v1${route}`,
    );
  });

  afterEach(() => {
    getSpy.mockRestore();
    postSpy.mockRestore();
    putSpy.mockRestore();
    deleteSpy.mockRestore();
    uploadSpy.mockRestore();
    consoleSpy.mockRestore();
    servicePathSpy.mockRestore();
  });

  function expectNoArtifactWrites() {
    expect(uploadSpy).not.toHaveBeenCalled();
    expect(putSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
  }

  test('publishes exact targets with per-target expectedRevision in one batch without uploading', async () => {
    await expect(retryStandalonePublish(appId, input)).resolves.toBe(
      deploymentIds.join(','),
    );

    expect(getSpy.mock.calls).toEqual(
      deploymentIds.map((id) => [`/admin/api/v1/deployments/${id}`]),
    );
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).toHaveBeenCalledWith(
      `/admin/api/v1/apps/${appId}/deployments/batch`,
      {
        idempotencyKey: expect.stringMatching(/^cli-[a-f0-9]{64}$/),
        commands: expectedCommands,
      },
    );
    expectNoArtifactWrites();
  });

  test('publishes one exact target with expectedRevision and no legacy revision field', async () => {
    await expect(retryStandalonePublish(appId, deploymentIds[0])).resolves.toBe(
      deploymentIds[0],
    );

    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).toHaveBeenCalledTimes(1);
    const commands = postSpy.mock.calls[0]?.[1]?.commands;
    expect(commands).toEqual([expectedCommands[0]]);
    expect(commands[0]).not.toHaveProperty('revision');
    expectNoArtifactWrites();
  });

  test('repeated retries reuse the same batch identity without creating or uploading artifacts', async () => {
    await retryStandalonePublish(appId, input);
    await retryStandalonePublish(appId, input);

    expect(getSpy).toHaveBeenCalledTimes(4);
    expect(postSpy).toHaveBeenCalledTimes(2);
    expect(postSpy.mock.calls[1]).toEqual(postSpy.mock.calls[0]);
    for (const [url, body] of postSpy.mock.calls) {
      expect(url).toBe(`/admin/api/v1/apps/${appId}/deployments/batch`);
      expect(body.commands).toEqual(expectedCommands);
    }
    expectNoArtifactWrites();
  });

  test.each([0, 1])(
    'propagates stale revision rejection for target %i without partial writes or fallback',
    async (staleIndex) => {
      const current = deployments.map((deployment, index) => ({
        ...deployment,
        revision: deployment.revision + (index === staleIndex ? 1 : 0),
        status: 'draft',
      }));
      const before = structuredClone(current);
      const conflict = new Error('409: deployment revision conflict');
      postSpy.mockImplementation(
        async (_url: string, body?: Record<string, unknown>) => {
          const commands = body?.commands as Array<{
            id: string;
            expectedRevision?: number;
          }>;
          if (
            commands.some((command) => {
              const target = current.find(({ id }) => id === command.id);
              return (
                command.expectedRevision !== undefined &&
                target?.revision !== command.expectedRevision
              );
            })
          ) {
            throw conflict;
          }
          for (const target of current) {
            target.revision += 1;
            target.status = 'published';
          }
          return { data: current };
        },
      );

      await expect(retryStandalonePublish(appId, input)).rejects.toBe(conflict);

      expect(current).toEqual(before);
      expect(getSpy).toHaveBeenCalledTimes(2);
      expect(postSpy).toHaveBeenCalledTimes(1);
      expect(postSpy.mock.calls[0]?.[1]?.commands).toEqual(expectedCommands);
      expect(consoleSpy).not.toHaveBeenCalled();
      expectNoArtifactWrites();
    },
  );

  test('dry-run reads exact targets and prints CAS commands with zero write requests', async () => {
    await expect(retryStandalonePublish(appId, input, true)).resolves.toBe(
      deploymentIds.join(','),
    );

    expect(getSpy).toHaveBeenCalledTimes(2);
    expect(postSpy).not.toHaveBeenCalled();
    expectNoArtifactWrites();
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(consoleSpy.mock.calls[0]?.[0])).toEqual({
      appId,
      deploymentIds,
      idempotencyKey: expect.stringMatching(/^cli-[a-f0-9]{64}$/),
      commands: expectedCommands,
      dryRun: true,
    });
  });

  test('dry-run previews the same CAS batch submitted by a real retry', async () => {
    await retryStandalonePublish(appId, input, true);
    expect(postSpy).not.toHaveBeenCalled();
    expectNoArtifactWrites();
    const preview = JSON.parse(consoleSpy.mock.calls[0]?.[0]);

    await retryStandalonePublish(appId, input);

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy.mock.calls[0]?.[1]).toEqual({
      idempotencyKey: preview.idempotencyKey,
      commands: preview.commands,
    });
    expectNoArtifactWrites();
  });
});
