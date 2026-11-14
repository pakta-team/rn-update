/**
 * [INPUT]: 依赖 getLatestVersions、registry/auth/HTTP/代理替身、固定时钟与隔离缓存
 * [OUTPUT]: 验证 scope 编码和认证代理、缓存期限/跨 registry 隔离及网络/响应/写入失败回退
 * [POS]: CLI npm latest 查询的传输与缓存契约回归，不访问真实 registry
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
import { EventEmitter } from 'events';
import fs from 'fs';
import http from 'http';
import https from 'https';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';

const registry = mock((_scope: string) => 'https://registry.test/npm/');
const auth = mock(
  (_url: string, _options: { recursive: boolean }) =>
    undefined as { type: string; token: string } | undefined,
);
mock.module('registry-auth-token/registry-url', () => ({ default: registry }));
mock.module('registry-auth-token', () => ({ default: auth }));

import { getLatestVersions } from '../src/utils/latest-version';
import * as runtime from '../src/utils/runtime';

const now = 1_800_000_000_000;
const oneDay = 86_400_000;
const registryUrl = 'https://registry.test/npm/';
let dir: string;
let previousCacheHome: string | undefined;
let status: number;
let payload: string;
let failure: 'request' | 'response' | 'timeout' | undefined;
let requests: http.RequestOptions[];
let sockets: { unref: ReturnType<typeof mock> }[];
let spies: { mockRestore(): void }[];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rnu-latest-version-'));
  previousCacheHome = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = dir;
  registry.mockReset().mockReturnValue(registryUrl);
  auth.mockReset().mockReturnValue(undefined);
  status = 200;
  payload = JSON.stringify({ 'dist-tags': { latest: '2.0.0', next: '3.0.0' } });
  failure = undefined;
  requests = [];
  sockets = [];
  const get = ((
    options: http.RequestOptions,
    callback: (res: Readable) => void,
  ) => {
    requests.push(options);
    const request = Object.assign(new EventEmitter(), {
      destroy: mock((error: Error) => request.emit('error', error)),
    });
    queueMicrotask(() => {
      const socket = { unref: mock(() => {}) };
      sockets.push(socket);
      request.emit('socket', socket);
      if (failure === 'request') {
        request.emit('error', new Error('registry offline'));
      } else if (failure === 'timeout') {
        request.emit('timeout');
      } else {
        const response = Object.assign(Readable.from([payload]), {
          statusCode: status,
        });
        callback(response);
        if (failure === 'response')
          response.destroy(new Error('response reset'));
      }
    });
    return request;
  }) as typeof http.get;
  spies = [
    spyOn(Date, 'now').mockReturnValue(now),
    spyOn(runtime, 'proxyAgentFor').mockReturnValue(undefined),
    spyOn(http, 'get').mockImplementation(get),
    spyOn(https, 'get').mockImplementation(get),
  ];
});

afterEach(() => {
  for (const spy of spies) spy.mockRestore();
  if (previousCacheHome === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = previousCacheHome;
  fs.rmSync(dir, { recursive: true, force: true });
});

function cacheFile(name = 'rn-update-cli') {
  return path.join(dir, '@badisi/latest-version', `${name}.json`);
}

function writeCache(
  overrides: Record<string, unknown> = {},
  name = 'rn-update-cli',
) {
  const file = cacheFile(name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({
      name,
      lastUpdateDate: now - 1,
      distTags: { latest: '1.0.0' },
      registryUrl,
      ...overrides,
    }),
  );
}

describe('latest-version registry and auth', () => {
  test('resolves scoped registries, encodes package paths and forwards auth and proxy', async () => {
    registry.mockReturnValue('http://registry.test:4873/private/');
    auth.mockReturnValue({ type: 'Bearer', token: 'test-token' });
    const agent = new http.Agent();
    spies.push(spyOn(runtime, 'proxyAgentFor').mockReturnValue(agent));
    try {
      expect(
        await getLatestVersions(['@pakta/cli'], { timeout: 1234, unref: true }),
      ).toEqual(['2.0.0']);
      expect(registry).toHaveBeenCalledWith('@pakta');
      expect(auth).toHaveBeenCalledWith(
        'http://registry.test:4873/private/@pakta%2Fcli',
        { recursive: true },
      );
      expect(runtime.proxyAgentFor).toHaveBeenCalledWith(
        'http://registry.test:4873/private/@pakta%2Fcli',
      );
      expect(http.get).toHaveBeenCalledTimes(1);
      expect(https.get).not.toHaveBeenCalled();
      expect(requests[0]).toEqual({
        host: 'registry.test',
        port: '4873',
        path: '/private/@pakta%2Fcli',
        timeout: 1234,
        agent,
        headers: {
          accept:
            'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*',
          authorization: 'Bearer test-token',
        },
      });
      expect(sockets[0].unref).toHaveBeenCalledTimes(1);
    } finally {
      agent.destroy();
    }
  });

  test('unscoped HTTPS requests omit auth and keep sockets referenced by default', async () => {
    expect(await getLatestVersions(['rn-update-cli'])).toEqual(['2.0.0']);
    expect(registry).toHaveBeenCalledWith('');
    expect(https.get).toHaveBeenCalledTimes(1);
    expect(http.get).not.toHaveBeenCalled();
    expect(requests[0].path).toBe('/npm/rn-update-cli');
    expect(requests[0].headers).not.toHaveProperty('authorization');
    expect(sockets[0].unref).not.toHaveBeenCalled();
    expect(fs.existsSync(cacheFile())).toBe(false);
  });

  test('preserves package ordering and isolates failures', async () => {
    writeCache({}, 'cached');
    failure = 'request';
    expect(
      await getLatestVersions(['missing', 'cached'], { useCache: true }),
    ).toEqual([undefined, '1.0.0']);
    expect(requests).toHaveLength(1);
    expect(await getLatestVersions([])).toEqual([]);
    expect(requests).toHaveLength(1);
  });
});

describe('latest-version cache freshness', () => {
  test.each([0, oneDay - 1])(
    'default cache accepts age %i without network',
    async (age) => {
      writeCache({ lastUpdateDate: now - age });
      const before = fs.readFileSync(cacheFile(), 'utf8');
      expect(
        await getLatestVersions(['rn-update-cli'], { useCache: true }),
      ).toEqual(['1.0.0']);
      expect(requests).toHaveLength(0);
      expect(auth).not.toHaveBeenCalled();
      expect(fs.readFileSync(cacheFile(), 'utf8')).toBe(before);
    },
  );

  test.each([oneDay, oneDay + 1, -1])(
    'default cache refreshes age %i and persists metadata',
    async (age) => {
      writeCache({ lastUpdateDate: now - age });
      expect(
        await getLatestVersions(['rn-update-cli'], { useCache: true }),
      ).toEqual(['2.0.0']);
      expect(requests).toHaveLength(1);
      expect(JSON.parse(fs.readFileSync(cacheFile(), 'utf8'))).toEqual({
        name: 'rn-update-cli',
        lastUpdateDate: now,
        distTags: { latest: '2.0.0', next: '3.0.0' },
        registryUrl,
      });
    },
  );

  test.each([
    [99, 100, '1.0.0', 0],
    [100, 100, '2.0.0', 1],
    [0, 0, '2.0.0', 1],
  ] as const)(
    'age %i with cacheMaxAge %i returns %s',
    async (age, cacheMaxAge, version, count) => {
      writeCache({ lastUpdateDate: now - age });
      expect(
        await getLatestVersions(['rn-update-cli'], {
          useCache: true,
          cacheMaxAge,
        }),
      ).toEqual([version]);
      expect(requests).toHaveLength(count);
    },
  );

  test('disabled cache neither reads nor overwrites existing metadata', async () => {
    writeCache();
    const before = fs.readFileSync(cacheFile(), 'utf8');
    expect(
      await getLatestVersions(['rn-update-cli'], { useCache: false }),
    ).toEqual(['2.0.0']);
    failure = 'request';
    expect(
      await getLatestVersions(['rn-update-cli'], { useCache: false }),
    ).toEqual([undefined]);
    expect(requests).toHaveLength(2);
    expect(fs.readFileSync(cacheFile(), 'utf8')).toBe(before);
  });

  test('a scoped cache miss creates parent directories and becomes a fresh hit', async () => {
    expect(await getLatestVersions(['@pakta/cli'], { useCache: true })).toEqual(
      ['2.0.0'],
    );
    expect(fs.existsSync(cacheFile('@pakta/cli'))).toBe(true);
    failure = 'request';
    expect(await getLatestVersions(['@pakta/cli'], { useCache: true })).toEqual(
      ['2.0.0'],
    );
    expect(requests).toHaveLength(1);
  });
});

describe('latest-version failure fallback', () => {
  test.each(['http', 'json', 'request', 'response', 'timeout'] as const)(
    '%s failure uses only valid same-registry stale metadata',
    async (kind) => {
      if (kind === 'http') status = 503;
      else if (kind === 'json') payload = '{';
      else failure = kind;
      writeCache({ lastUpdateDate: now - oneDay });
      const before = fs.readFileSync(cacheFile(), 'utf8');
      expect(
        await getLatestVersions(['rn-update-cli'], { useCache: true }),
      ).toEqual(['1.0.0']);
      expect(fs.readFileSync(cacheFile(), 'utf8')).toBe(before);
      expect(await getLatestVersions(['uncached'], { useCache: true })).toEqual(
        [undefined],
      );
      expect(requests).toHaveLength(2);
    },
  );

  test('cacheMaxAge zero still retains a stale fallback', async () => {
    writeCache({ lastUpdateDate: now });
    failure = 'request';
    expect(
      await getLatestVersions(['rn-update-cli'], {
        useCache: true,
        cacheMaxAge: 0,
      }),
    ).toEqual(['1.0.0']);
    expect(requests).toHaveLength(1);
  });

  test.each([
    { registryUrl: 'https://other-registry.test/' },
    { registryUrl: undefined },
    { lastUpdateDate: 'invalid' },
    { distTags: null },
  ])('invalid cache %j is neither a hit nor a fallback', async (overrides) => {
    writeCache(overrides);
    failure = 'request';
    expect(
      await getLatestVersions(['rn-update-cli'], { useCache: true }),
    ).toEqual([undefined]);
    expect(requests).toHaveLength(1);
  });

  test('corrupt cache is replaced after a successful refresh', async () => {
    writeCache();
    fs.writeFileSync(cacheFile(), '{');
    expect(
      await getLatestVersions(['rn-update-cli'], { useCache: true }),
    ).toEqual(['2.0.0']);
    expect(
      JSON.parse(fs.readFileSync(cacheFile(), 'utf8')).distTags.latest,
    ).toBe('2.0.0');
  });

  test('cache write failure does not hide a successful registry result', async () => {
    fs.writeFileSync(path.join(dir, '@badisi'), 'not a directory');
    expect(
      await getLatestVersions(['rn-update-cli'], { useCache: true }),
    ).toEqual(['2.0.0']);
    expect(requests).toHaveLength(1);
  });
});
