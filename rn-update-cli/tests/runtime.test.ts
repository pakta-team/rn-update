import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import fs from 'fs';
import { createServer } from 'net';
import os from 'os';
import path from 'path';
import {
  detectPackageManager,
  getInstallCommand,
  getJavaScriptRuntime,
  isBunRuntime,
  measureTcpLatency,
  resolveProxy,
} from '../src/utils/runtime';

function mkTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('runtime package manager detection', () => {
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = mkTempDir('rn-update-runtime-');
  });

  afterEach(() => {
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('uses bun when npm user agent is bun', () => {
    expect(
      detectPackageManager(tempRoot, {
        npm_config_user_agent: 'bun/1.3.0 npm/? node/v24',
      }),
    ).toBe('bun');
  });

  test('uses lockfile when no package manager user agent is present', () => {
    fs.writeFileSync(path.join(tempRoot, 'pnpm-lock.yaml'), '');

    expect(detectPackageManager(tempRoot, {})).toBe('pnpm');
  });

  test('prefers project lockfile over current process user agent', () => {
    fs.writeFileSync(path.join(tempRoot, 'package-lock.json'), '');

    expect(
      detectPackageManager(tempRoot, {
        npm_config_user_agent: 'bun/1.3.0 npm/? node/v24',
      }),
    ).toBe('npm');
  });

  test('builds bun add command for bun projects', () => {
    fs.writeFileSync(path.join(tempRoot, 'bun.lock'), '');

    expect(getInstallCommand(['node-hdiffpatch'], tempRoot)).toEqual({
      command: 'bun',
      args: ['add', 'node-hdiffpatch'],
    });
  });

  test('builds npm install command for npm projects', () => {
    fs.writeFileSync(path.join(tempRoot, 'package-lock.json'), '');

    expect(getInstallCommand(['node-hdiffpatch'], tempRoot)).toEqual({
      command: 'npm',
      args: ['install', 'node-hdiffpatch'],
    });
  });
});

describe('runtime JavaScript runner selection', () => {
  test('defaults project scripts to node', () => {
    expect(getJavaScriptRuntime({})).toBe('node');
  });

  test('can explicitly run project scripts with bun', () => {
    expect(getJavaScriptRuntime({ RNU_JS_RUNTIME: 'bun' })).toBe('bun');
  });

  test('can auto-select bun only under bun runtime', () => {
    expect(getJavaScriptRuntime({ RNU_JS_RUNTIME: 'auto' })).toBe(
      isBunRuntime ? 'bun' : 'node',
    );
  });
});

describe('CommonJS runtime dependencies', () => {
  test('loads chalk with Node.js require', () => {
    const result = spawnSync('node', ['-e', "require('chalk')"], {
      cwd: path.resolve(import.meta.dir, '..'),
      encoding: 'utf8',
    });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});

describe('runtime TCP latency measurement', () => {
  test('measures latency with native net sockets', async () => {
    const server = createServer((socket) => {
      socket.end();
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Unable to bind local TCP server');
    }

    try {
      const latency = await measureTcpLatency(
        `http://127.0.0.1:${address.port}/upload`,
        {
          attempts: 2,
          timeout: 1000,
        },
      );
      expect(Number.isFinite(latency)).toBe(true);
    } finally {
      server.close();
    }
  });
});

describe('resolveProxy', () => {
  test('picks the proxy by target scheme, upper or lower case', () => {
    expect(
      resolveProxy('https://api.example.com/x', {
        HTTPS_PROXY: 'http://p:3128',
      }),
    ).toBe('http://p:3128');
    expect(
      resolveProxy('http://api.example.com/x', { http_proxy: 'http://p:3128' }),
    ).toBe('http://p:3128');
    // https falls back to HTTP_PROXY, like npm and undici
    expect(
      resolveProxy('https://api.example.com/x', {
        HTTP_PROXY: 'http://p:3128',
      }),
    ).toBe('http://p:3128');
    expect(
      resolveProxy('http://api.example.com/x', {
        HTTPS_PROXY: 'http://p:3128',
      }),
    ).toBeUndefined();
  });

  test('is direct without a proxy variable or for unsupported urls', () => {
    expect(resolveProxy('https://api.example.com', {})).toBeUndefined();
    expect(
      resolveProxy('not a url', { HTTPS_PROXY: 'http://p:3128' }),
    ).toBeUndefined();
    expect(
      resolveProxy('https://api.example.com', {
        HTTPS_PROXY: 'socks5://p:1080',
      }),
    ).toBeUndefined();
    expect(
      resolveProxy('https://api.example.com', { HTTPS_PROXY: '   ' }),
    ).toBeUndefined();
  });

  test('honors NO_PROXY host lists', () => {
    const env = {
      HTTPS_PROXY: 'http://p:3128',
      NO_PROXY: 'localhost,127.0.0.1,.internal.example.com, other.com:8443',
    };
    expect(resolveProxy('https://127.0.0.1:9000/', env)).toBeUndefined();
    expect(resolveProxy('https://localhost/', env)).toBeUndefined();
    expect(
      resolveProxy('https://api.internal.example.com/', env),
    ).toBeUndefined();
    expect(resolveProxy('https://internal.example.com/', env)).toBeUndefined();
    expect(resolveProxy('https://other.com:8443/', env)).toBeUndefined();
    expect(resolveProxy('https://other.com/', env)).toBe('http://p:3128');
    expect(resolveProxy('https://api.example.com/', env)).toBe('http://p:3128');
    expect(
      resolveProxy('https://api.example.com/', {
        HTTPS_PROXY: 'http://p:3128',
        no_proxy: '*',
      }),
    ).toBeUndefined();
    expect(
      resolveProxy('https://sub.example.com/', {
        HTTPS_PROXY: 'http://p:3128',
        NO_PROXY: '*.example.com',
      }),
    ).toBeUndefined();
  });
});
