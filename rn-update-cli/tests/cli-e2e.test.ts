/**
 * [INPUT]: 依赖编译后的 CLI 入口、隔离 HTTP 伪服务、运行时环境变量与临时项目文件
 * [OUTPUT]: 验证 CLI 进程级语言输出、认证失败提示、上传和发布链路
 * [POS]: tests 的进程边界验收；对象存储替身完整接收请求体后响应，避免提前断连干扰上传结果
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

type CliResult = {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

type MockServerOptions = {
  unauthorizedApps?: boolean;
  createdVersions?: unknown[];
};

const repoRoot = import.meta.dir.replace(/[\\/]tests$/, '');

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
) {
  response.writeHead(statusCode, {
    connection: 'close',
    'content-type': 'application/json',
  });
  response.end(JSON.stringify(body));
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function createMockServer(requests: string[], options: MockServerOptions = {}) {
  return createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      const url = request.url ?? '/';
      requests.push(`${request.method ?? 'GET'} ${url}`);

      if (url.startsWith('/registry/rn-update-cli')) {
        sendJson(response, 200, {
          versions: { '2.8.5': {} },
          'dist-tags': { latest: '2.8.5' },
        });
        return;
      }

      if (url.startsWith('/registry/rn-update')) {
        sendJson(response, 200, {
          versions: { '10.27.0': {} },
          'dist-tags': { latest: '10.27.0' },
        });
        return;
      }

      if (url === '/api/app/list') {
        if (options.unauthorizedApps) {
          sendJson(response, 401, { message: 'unauthorized' });
          return;
        }
        sendJson(response, 200, {
          data: [{ id: 100, name: 'DemoApp', platform: 'ios' }],
        });
        return;
      }

      if (url === '/api/upload') {
        sendJson(response, 200, {
          url: `${getOrigin(request)}/oss/upload`,
          formData: { key: 'hash-from-oss' },
        });
        return;
      }

      if (url === '/oss/upload') {
        await readBody(request);
        response.writeHead(204, { connection: 'close' });
        response.end();
        return;
      }

      if (url.startsWith('/api/app/') && url.endsWith('/version/create')) {
        const body = await readBody(request);
        options.createdVersions?.push(JSON.parse(body));
        sendJson(response, 200, { id: '200' });
        return;
      }

      sendJson(response, 404, { message: `Unhandled ${url}` });
    })().catch((error) => {
      sendJson(response, 500, { message: String(error) });
    });
  });
}

function getOrigin(request: IncomingMessage) {
  return `http://${request.headers.host}`;
}

function runCli({
  args,
  cwd = repoRoot,
  env,
}: {
  args: string[];
  cwd?: string;
  env: NodeJS.ProcessEnv;
}): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    // The tests run the CLI with bun. Outside a project bun auto-installs any
    // bare specifier a failed `require.resolve` asks for (@pnpm/npm-conf probes
    // for `npm`, diff.ts for the optional node-hdiffpatch), hitting the mock
    // registry and racing "error: GET .../registry/npm - 404" onto stderr.
    // Node never does that, so switch the runtime feature off.
    const child = spawn(process.execPath, ['--no-install', ...args], {
      cwd,
      // 固定进程级断言并显式覆盖国际化默认行为；中文覆盖位于 i18n.test。
      env: { ...env, RNU_LANG: 'en' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`CLI timed out: ${args.join(' ')}`));
    }, 10_000);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (status, signal) => {
      clearTimeout(timeout);
      resolve({ status, signal, stdout, stderr });
    });
  });
}

describe('CLI e2e', () => {
  let closeServer: (() => Promise<void>) | undefined;
  // the CLI caches registry lookups for a day: give every run an empty cache
  // so the registry requests asserted below are always made, without touching
  // the developer's real cache
  let cacheHome: string;

  beforeAll(async () => {
    cacheHome = await mkdtemp(path.join(tmpdir(), 'rn-update-cli-cache-'));
  });

  afterAll(async () => {
    await rm(cacheHome, { force: true, recursive: true });
  });

  afterEach(async () => {
    await closeServer?.();
    closeServer = undefined;
  });

  test('runs apps command against a local API endpoint', async () => {
    const requests: string[] = [];
    const server = createMockServer(requests);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    closeServer = () =>
      new Promise((resolve, reject) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close((error) => {
          server.closeAllConnections?.();
          if (error) {
            if (
              (error as NodeJS.ErrnoException).code === 'ERR_SERVER_NOT_RUNNING'
            ) {
              resolve();
              return;
            }
            reject(error);
            return;
          }
          resolve();
        });
      });

    const { port } = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${port}`;
    const result = await runCli({
      args: ['src/bin.ts', 'apps', '--no-interactive'],
      env: {
        ...process.env,
        NO_INTERACTIVE: 'true',
        PAKTA_REGISTRY: `${origin}/api`,
        npm_config_registry: `${origin}/registry/`,
        XDG_CACHE_HOME: cacheHome,
      },
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('rn-update-cli');
    expect(result.stdout).toContain('DemoApp');
    expect(requests).toContain('GET /registry/rn-update-cli');
    expect(requests).toContain('GET /registry/rn-update');
    expect(requests).toContain('GET /api/app/list');
  });

  test('prints login guidance for 401 API responses', async () => {
    const requests: string[] = [];
    const server = createMockServer(requests, { unauthorizedApps: true });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    closeServer = () =>
      new Promise((resolve) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close(() => {
          server.closeAllConnections?.();
          resolve();
        });
      });

    const { port } = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${port}`;
    const result = await runCli({
      args: ['src/bin.ts', 'apps', '--no-interactive'],
      env: {
        ...process.env,
        NO_INTERACTIVE: 'true',
        PAKTA_REGISTRY: `${origin}/api`,
        npm_config_registry: `${origin}/registry/`,
        XDG_CACHE_HOME: cacheHome,
      },
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Not logged in.');
    expect(result.stderr).toBe('');
    expect(requests).toContain('GET /api/app/list');
  });

  test('publishes a ppk in non-interactive mode against local upload endpoints', async () => {
    const requests: string[] = [];
    const createdVersions: unknown[] = [];
    const server = createMockServer(requests, { createdVersions });
    let tempRoot: string | undefined;

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    closeServer = () =>
      new Promise((resolve) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close(() => {
          server.closeAllConnections?.();
          resolve();
        });
      });

    try {
      tempRoot = await mkdtemp(path.join(tmpdir(), 'rn-update-cli-e2e-'));
      await writeFile(
        path.join(tempRoot, 'update.json'),
        JSON.stringify({
          android: {
            appId: 100,
            appKey: 'android-key',
          },
        }),
      );
      await writeFile(path.join(tempRoot, 'bundle.ppk'), 'fake-ppk');

      const { port } = server.address() as AddressInfo;
      const origin = `http://127.0.0.1:${port}`;
      const result = await runCli({
        args: [
          path.join(repoRoot, 'src/bin.ts'),
          'publish',
          'bundle.ppk',
          '--platform',
          'android',
          '--name',
          'v1',
          '--no-interactive',
        ],
        cwd: tempRoot,
        env: {
          ...process.env,
          NO_INTERACTIVE: 'true',
          PAKTA_REGISTRY: `${origin}/api`,
          npm_config_registry: `${origin}/registry/`,
          XDG_CACHE_HOME: cacheHome,
        },
      });

      expect(result.status).toBe(0);
      expect(result.stderr.trim()).toBe('');
      expect(requests).toContain('POST /api/upload');
      expect(requests).toContain('POST /oss/upload');
      expect(requests).toContain('POST /api/app/100/version/create');
      expect(createdVersions).toEqual([
        expect.objectContaining({
          name: 'v1',
          hash: 'hash-from-oss',
          description: '',
          metaInfo: '',
        }),
      ]);
    } finally {
      if (tempRoot) {
        await rm(tempRoot, { force: true, recursive: true });
      }
    }
  });

  test('publishes a ppk using custom config path', async () => {
    const requests: string[] = [];
    const createdVersions: unknown[] = [];
    const server = createMockServer(requests, { createdVersions });
    let tempRoot: string | undefined;

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    closeServer = () =>
      new Promise((resolve) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close(() => {
          server.closeAllConnections?.();
          resolve();
        });
      });

    try {
      tempRoot = await mkdtemp(path.join(tmpdir(), 'rn-update-cli-e2e-'));
      await writeFile(
        path.join(tempRoot, 'update-custom.json'),
        JSON.stringify({
          android: {
            appId: 105,
            appKey: 'android-key-custom',
          },
        }),
      );
      await writeFile(path.join(tempRoot, 'bundle.ppk'), 'fake-ppk');

      const { port } = server.address() as AddressInfo;
      const origin = `http://127.0.0.1:${port}`;
      const result = await runCli({
        args: [
          path.join(repoRoot, 'src/bin.ts'),
          'publish',
          'bundle.ppk',
          '--platform',
          'android',
          '--name',
          'v1-custom',
          '--config',
          'update-custom.json',
          '--no-interactive',
        ],
        cwd: tempRoot,
        env: {
          ...process.env,
          NO_INTERACTIVE: 'true',
          PAKTA_REGISTRY: `${origin}/api`,
          npm_config_registry: `${origin}/registry/`,
          XDG_CACHE_HOME: cacheHome,
        },
      });

      expect(result.status).toBe(0);
      expect(result.stderr.trim()).toBe('');
      expect(requests).toContain('POST /api/upload');
      expect(requests).toContain('POST /oss/upload');
      expect(requests).toContain('POST /api/app/105/version/create');
      expect(createdVersions).toEqual([
        expect.objectContaining({
          name: 'v1-custom',
          hash: 'hash-from-oss',
          description: '',
          metaInfo: '',
        }),
      ]);
    } finally {
      if (tempRoot) {
        await rm(tempRoot, { force: true, recursive: true });
      }
    }
  });
});
