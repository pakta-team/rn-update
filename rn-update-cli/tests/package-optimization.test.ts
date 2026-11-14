/**
 * [INPUT]: 依赖 choosePackage、包列表/交互输入替身与临时 TTY 标记
 * [OUTPUT]: 验证有效 ID 返回目标原生包及无效选择后继续提示直到合法输入
 * [POS]: CLI 原生包选择回归，通过隔离交互避免把重复拉取优化与真实 API 验收混同
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { describe, expect, mock, spyOn, test } from 'bun:test';

// Mock modules before any imports
mock.module('filesize-parser', () => ({ default: () => 0 }));
mock.module('tty-table', () => {
  const mockTable = () => ({ render: () => '' });
  return { default: mockTable };
});
mock.module('read', () => ({ read: () => {} }));
mock.module('compare-versions', () => ({
  satisfies: () => true,
}));
mock.module('registry-auth-token', () => ({}));
mock.module(
  'registry-auth-token/registry-url',
  () => () => 'https://registry.npmjs.org',
);
mock.module('semver', () => ({}));
mock.module('semver/functions/gt', () => () => true);
mock.module(
  'semver/ranges/max-satisfying',
  () => (versions: string[]) => versions[0],
);
mock.module('bytebuffer', () => ({}));

import * as api from '../src/api';
import { choosePackage } from '../src/package';
import * as utils from '../src/utils';

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

describe('choosePackage optimization', () => {
  test('should return the correct package when a valid ID is entered', async () => {
    const mockPackages = [
      { id: '101', name: 'package1' },
      { id: '102', name: 'package2' },
    ];

    const getAllPackagesSpy = spyOn(api, 'getAllPackages').mockResolvedValue(
      mockPackages as any,
    );
    const questionSpy = spyOn(utils, 'question').mockResolvedValue('102');
    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});

    const result = await withInteractiveStdin(() => choosePackage('app123'));

    expect(result).toEqual(mockPackages[1] as any);
    expect(getAllPackagesSpy).toHaveBeenCalledWith('app123');
    expect(questionSpy).toHaveBeenCalled();

    getAllPackagesSpy.mockRestore();
    questionSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  test('should continue to prompt until a valid ID is entered', async () => {
    const mockPackages = [{ id: '201', name: 'packageA' }];

    const getAllPackagesSpy = spyOn(api, 'getAllPackages').mockResolvedValue(
      mockPackages as any,
    );

    const questionMock = mock();
    questionMock
      .mockResolvedValueOnce('999') // Invalid ID
      .mockResolvedValueOnce('201'); // Valid ID

    const questionSpy = spyOn(utils, 'question').mockImplementation(
      questionMock,
    );
    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});

    const result = await withInteractiveStdin(() => choosePackage('app123'));

    expect(result).toEqual(mockPackages[0] as any);
    expect(questionMock).toHaveBeenCalledTimes(2);

    getAllPackagesSpy.mockRestore();
    questionSpy.mockRestore();
    consoleSpy.mockRestore();
  });
});
