#!/usr/bin/env node
/**
 * [INPUT]: 依赖已编译 lib、当前 Node 运行时、本地旧 API 伪服务与代理子进程
 * [OUTPUT]: 对外提供全模块加载、最低 Node 版本命令及本地兼容上传链路烟雾验证
 * [POS]: scripts 运行时兼容守门，固定本地伪服务为显式测试兼容模式，补足 Bun 测试无法证明的 Node 装载能力
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const lib = path.resolve(__dirname, '..', 'lib');
if (!fs.existsSync(lib)) {
  console.error('lib/ not found: run `bun run build` first');
  process.exit(1);
}

// these two run the CLI when required
const entryPoints = new Set(['bin.js']);

function listJs(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listJs(full));
    } else if (entry.name.endsWith('.js')) {
      files.push(full);
    }
  }
  return files.sort();
}

let loaded = 0;
for (const file of listJs(lib)) {
  if (entryPoints.has(path.relative(lib, file))) continue;
  require(file);
  loaded += 1;
}
console.log(
  `smoke: loaded ${loaded} modules from lib/ on node ${process.version}`,
);

const CLI_TIMEOUT_MS = 10_000;

function runCli(args) {
  const result = spawnSync(
    process.execPath,
    [path.join(lib, 'bin.js'), ...args],
    {
      encoding: 'utf8',
      env: { ...process.env, NO_INTERACTIVE: 'true', RNU_AUTO_UPDATE: '0' },
      timeout: CLI_TIMEOUT_MS,
    },
  );
  const command = `pakta ${args.join(' ')}`;
  if (result.error) {
    if (result.error.code === 'ETIMEDOUT') {
      throw new Error(
        `${command} timed out after ${CLI_TIMEOUT_MS / 1000} seconds`,
      );
    }
    throw result.error;
  }
  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    throw new Error(`${command} exited with ${result.status}`);
  }
  // a deprecation or experimental warning on every command is a bug (it was
  // the punycode DEP0040 warning from node-fetch until 2.24)
  if (/(Deprecation|Experimental)Warning/.test(result.stderr)) {
    throw new Error(`${command} printed a runtime warning:\n${result.stderr}`);
  }
  return result;
}

runCli(['help']);
runCli(['-v']);
console.log('smoke: `help` and `-v` ran without warnings');

// --- proxy scenario ---------------------------------------------------------
// Node's built-in fetch ignores HTTP(S)_PROXY, so the CLI routes every request
// itself (src/utils/runtime.ts): every client opens a CONNECT tunnel through
// the proxy. A mock API and a local forward proxy show that the API call, the
// registry check and the multipart upload all tunnel through the proxy, and
// that NO_PROXY switches it off again.

const http = require('node:http');
const net = require('node:net');
const os = require('node:os');

function listen(server) {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(server.address().port)),
  );
}

function createMockApi(requests) {
  return http.createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    const json = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const url = req.url ?? '/';
    if (url.startsWith('/registry/')) {
      return json(200, { versions: {}, 'dist-tags': { latest: '0.0.0' } });
    }
    if (url === '/api/app/list') {
      return json(200, {
        data: [{ id: 100, name: 'DemoApp', platform: 'android' }],
      });
    }
    if (url === '/api/upload') {
      return json(200, {
        url: `http://${req.headers.host}/oss/upload`,
        formData: { key: 'hash-from-oss' },
      });
    }
    if (url === '/oss/upload') {
      req.resume();
      req.on('end', () => {
        res.writeHead(204);
        res.end();
      });
      return;
    }
    if (url === '/api/app/100/version/create') {
      req.resume();
      req.on('end', () => json(200, { id: 1 }));
      return;
    }
    json(404, { message: `unhandled ${url}` });
  });
}

function createForwardProxy(seen) {
  const proxy = http.createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    const target = new URL(req.url);
    // hop-by-hop headers are not forwarded; the client below frames the body
    // itself (a copied transfer-encoding would make the upstream reject it)
    const {
      connection: _connection,
      'proxy-connection': _proxyConnection,
      'keep-alive': _keepAlive,
      'transfer-encoding': _transferEncoding,
      ...headers
    } = req.headers;
    const upstream = http.request(
      {
        host: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: req.method,
        headers: { ...headers, host: target.host },
      },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      },
    );
    upstream.on('error', (error) => {
      res.writeHead(502);
      res.end(String(error));
    });
    req.pipe(upstream);
  });
  proxy.on('connect', (req, socket, head) => {
    seen.push(`CONNECT ${req.url}`);
    const [host, port] = req.url.split(':');
    const tunnel = net.connect(Number(port), host, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) tunnel.write(head);
      socket.pipe(tunnel);
      tunnel.pipe(socket);
    });
    tunnel.on('error', () => socket.destroy());
    socket.on('error', () => tunnel.destroy());
  });
  return proxy;
}

async function proxyScenario() {
  const apiRequests = [];
  const seenByProxy = [];
  const api = createMockApi(apiRequests);
  const proxy = createForwardProxy(seenByProxy);
  const apiPort = await listen(api);
  const proxyPort = await listen(proxy);
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'rnu-smoke-project-'));
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'rnu-smoke-cache-'));
  fs.writeFileSync(
    path.join(project, 'update.json'),
    JSON.stringify({ android: { appId: 100, appKey: 'key' } }),
  );
  fs.writeFileSync(path.join(project, 'bundle.ppk'), 'fake-ppk');
  const baseEnv = {
    ...process.env,
    NO_INTERACTIVE: 'true',
    RNU_AUTO_UPDATE: '0',
    PAKTA_TEST_COMPAT_ROUTES: '1',
    PAKTA_REGISTRY: `http://127.0.0.1:${apiPort}/api`,
    npm_config_registry: `http://127.0.0.1:${apiPort}/registry/`,
    XDG_CACHE_HOME: cache,
    HTTP_PROXY: `http://127.0.0.1:${proxyPort}`,
    http_proxy: `http://127.0.0.1:${proxyPort}`,
    HTTPS_PROXY: '',
    https_proxy: '',
    NO_PROXY: '',
    no_proxy: '',
  };
  // asynchronous: spawnSync would block this process, and with it the mock
  // API and the proxy the CLI is talking to
  const run = (args, env) =>
    new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [path.join(lib, 'bin.js'), ...args],
        { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`pakta ${args.join(' ')} timed out`));
      }, 30_000);
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (status) => {
        clearTimeout(timer);
        if (status !== 0) {
          console.error(stdout);
          console.error(stderr);
          reject(new Error(`pakta ${args.join(' ')} exited with ${status}`));
          return;
        }
        resolve({ stdout, stderr });
      });
    });
  // tunnels to the mock host: the API client (undici), the registry check
  // (http.get) and the upload (node-fetch) each open their own
  const tunnels = () =>
    seenByProxy.filter((line) => line === `CONNECT 127.0.0.1:${apiPort}`)
      .length;
  try {
    await run(['apps', '--no-interactive'], baseEnv);
    if (tunnels() < 2) {
      throw new Error(
        `the API call or the registry check bypassed HTTP_PROXY: ${JSON.stringify(seenByProxy)}`,
      );
    }
    if (!apiRequests.includes('GET /api/app/list')) {
      throw new Error(
        `apps did not reach the API: ${JSON.stringify(apiRequests)}`,
      );
    }
    seenByProxy.length = 0;
    apiRequests.length = 0;
    await run(
      [
        'publish',
        'bundle.ppk',
        '--platform',
        'android',
        '--name',
        'v1',
        '--no-interactive',
      ],
      baseEnv,
    );
    if (tunnels() < 2) {
      throw new Error(
        `the upload bypassed HTTP_PROXY: ${JSON.stringify(seenByProxy)}`,
      );
    }
    if (!apiRequests.includes('POST /oss/upload')) {
      throw new Error(
        `the upload did not arrive: ${JSON.stringify(apiRequests)}`,
      );
    }
    if (!apiRequests.includes('POST /api/app/100/version/create')) {
      throw new Error(
        `publish did not reach the API: ${JSON.stringify(apiRequests)}`,
      );
    }
    seenByProxy.length = 0;
    apiRequests.length = 0;
    await run(['apps', '--no-interactive'], {
      ...baseEnv,
      NO_PROXY: '127.0.0.1',
    });
    if (seenByProxy.length > 0) {
      throw new Error(`NO_PROXY was ignored: ${JSON.stringify(seenByProxy)}`);
    }
    if (!apiRequests.includes('GET /api/app/list')) {
      throw new Error(
        `the API call did not arrive directly: ${JSON.stringify(apiRequests)}`,
      );
    }
    console.log(
      'smoke: API, registry check and upload honor HTTP_PROXY and NO_PROXY',
    );
  } finally {
    api.close();
    proxy.close();
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(cache, { recursive: true, force: true });
  }
}

proxyScenario().catch((error) => {
  console.error(error);
  process.exit(1);
});
