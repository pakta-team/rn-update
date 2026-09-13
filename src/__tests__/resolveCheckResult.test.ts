/**
 * [INPUT]: 依赖 ../updateFlowCore 的 resolveCheckResult，使用 CheckResult 与 UpdateIdentity 夹具模拟根版本、灰度版本、rollout 配置和缺失 hash
 * [OUTPUT]: 提供检查响应归一化契约，锁定当前版本判定、灰度选择、字段继承边界与不可下载结果的纯决策
 * [POS]: __tests__ 的检查结果决策单测，位于网络响应与 client 下载编排之间，不触发 IO
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { describe, expect, test } from 'bun:test';
import type { CheckResult } from '../type';
import { resolveCheckResult, type UpdateIdentity } from '../updateFlowCore';

const identity: UpdateIdentity = {
  packageVersion: '1.0.0',
  currentVersion: 'current-hash',
  uuid: 'any-uuid',
};

const createRootResult = (
  overrides: Partial<CheckResult> = {}
): CheckResult => ({
  update: true,
  hash: 'full-hash',
  name: 'full-version',
  description: 'full description',
  metaInfo: 'full meta',
  diff: 'current-full.hdiff',
  pdiff: 'package-full.phdiff',
  full: 'full-hash',
  paths: ['cdn.example.com'],
  ...overrides,
});

describe('resolveCheckResult', () => {
  test('returns upToDate when rollout target is already current', () => {
    const result = resolveCheckResult(
      createRootResult({
        expVersion: {
          name: 'gray-current',
          hash: identity.currentVersion!,
          description: 'gray description',
          metaInfo: 'gray meta',
          config: {
            rollout: {
              [identity.packageVersion]: 100,
            },
          },
        },
      }),
      identity
    );

    expect(result).toEqual({ upToDate: true });
  });

  test('does not inherit root diff artifacts for rollout target', () => {
    const result = resolveCheckResult(
      createRootResult({
        expVersion: {
          name: 'gray-next',
          hash: 'gray-hash',
          description: 'gray description',
          metaInfo: 'gray meta',
          config: {
            rollout: {
              [identity.packageVersion]: 100,
            },
          },
        },
      }),
      identity
    );

    expect(result).toEqual({
      update: true,
      hash: 'gray-hash',
      name: 'gray-next',
      description: 'gray description',
      metaInfo: 'gray meta',
      config: {
        rollout: {
          [identity.packageVersion]: 100,
        },
      },
      paths: ['cdn.example.com'],
    });
  });

  test('falls back to root result when rollout target is not selected', () => {
    const result = resolveCheckResult(
      createRootResult({
        expVersion: {
          name: 'gray-next',
          hash: 'gray-hash',
          description: 'gray description',
          metaInfo: 'gray meta',
          config: {
            rollout: {
              [identity.packageVersion]: 0,
            },
          },
        },
      }),
      identity
    );

    expect(result).toEqual(createRootResult());
  });

  test('returns upToDate when root target is already current', () => {
    const result = resolveCheckResult(
      createRootResult({ hash: identity.currentVersion }),
      identity
    );

    expect(result).toEqual({ upToDate: true });
  });

  test('ignores rollout config for a different packageVersion', () => {
    const result = resolveCheckResult(
      createRootResult({
        expVersion: {
          name: 'gray-next',
          hash: 'gray-hash',
          description: 'gray description',
          metaInfo: 'gray meta',
          config: {
            rollout: {
              'some-other-package': 100,
            },
          },
        },
      }),
      identity
    );

    expect(result).toEqual(createRootResult());
  });

  test('does not treat two missing hashes as already current', () => {
    const result = resolveCheckResult(
      createRootResult({
        expVersion: {
          name: 'gray-without-hash',
          config: {
            rollout: {
              [identity.packageVersion]: 100,
            },
          },
        } as any,
      }),
      { ...identity, currentVersion: undefined }
    );

    expect(result).toEqual({
      update: true,
      name: 'gray-without-hash',
      config: {
        rollout: {
          [identity.packageVersion]: 100,
        },
      },
      paths: ['cdn.example.com'],
    });

    expect(
      resolveCheckResult(
        { update: true },
        { ...identity, currentVersion: undefined }
      )
    ).toEqual({ update: true });
  });
});
