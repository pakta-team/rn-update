/**
 * [INPUT]: 依赖 React 与 react-test-renderer 的受控渲染，依赖 ../context 的 UpdateContext/useUpdate，以及开发态 i18n 错误文案
 * [OUTPUT]: 提供 Provider 外 hook 守卫与 Provider 内上下文透传的 React 合约回归
 * [POS]: __tests__ 的 Context 边界单测，隔离 context 的消费语义，不跨越 UpdateProvider 的状态编排实现
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { afterAll, describe, expect, test } from 'bun:test';
import React from 'react';
import TestRenderer from 'react-test-renderer';

// Must set __DEV__ before importing context.ts
const _origDEV = (globalThis as any).__DEV__;
(globalThis as any).__DEV__ = true;

const { useUpdate, UpdateContext } = await import('../context');
const { default: i18n } = await import('../i18n');

const renderHook = <T>(hook: () => T) => {
  const result: { current?: T } = {};
  const Probe = () => {
    result.current = hook();
    return null;
  };
  TestRenderer.act(() => {
    TestRenderer.create(React.createElement(Probe));
  });
  return result;
};

describe('context', () => {
  afterAll(() => {
    (globalThis as any).__DEV__ = _origDEV;
  });

  test('useUpdate throws error when used outside UpdateProvider in __DEV__', () => {
    expect(() => renderHook(() => useUpdate())).toThrow(
      i18n.t('error_use_update_outside_provider')
    );
  });

  test('useUpdate returns context when used inside UpdateProvider', () => {
    const client = {} as any;
    const Probe = () => {
      probed.current = useUpdate();
      return null;
    };
    const probed: { current?: ReturnType<typeof useUpdate> } = {};
    TestRenderer.act(() => {
      TestRenderer.create(
        React.createElement(
          UpdateContext.Provider,
          { value: { client } as any },
          React.createElement(Probe)
        )
      );
    });
    expect(probed.current?.client).toBe(client);
  });
});
