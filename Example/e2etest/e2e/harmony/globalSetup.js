/**
 * [INPUT]: 依赖 Node 进程/文件/HTTP API、跨平台 Bun 可执行文件与制品准备脚本
 * [OUTPUT]: 对外提供 Harmony e2e 的服务启动、单飞探活与设备准备 hook
 * [POS]: e2e/harmony 的平台全局 setup，不定义更新判定
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { stopServerFromPidFile } = require('./server-process');

const PORT = 31337;
const projectRoot = path.resolve(__dirname, '../..');
const artifactsRoot = path.join(projectRoot, '.e2e-artifacts');
const pidFile = path.join(artifactsRoot, '.server.harmony.pid');

function resolveBunCommand() {
  const explicit = process.env.RNU_BUN_BINARY;
  const bundledBun = path.join(
    path.dirname(process.execPath),
    'node_modules',
    'bun',
    'bin',
    'bun.exe'
  );
  if (explicit) {
    // Node's Windows child_process.spawn cannot execute a .cmd shim with
    // shell=false (EINVAL). Resolve the standard Bun shim to its real binary
    // so the setup hook works without a caller-specific workaround.
    if (/\.cmd$/i.test(explicit) && fs.existsSync(bundledBun)) {
      return bundledBun;
    }
    return explicit;
  }
  if (process.platform === 'win32') {
    if (fs.existsSync(bundledBun)) {
      return bundledBun;
    }
    return 'bun';
  }
  return 'bun';
}

async function killExistingServer() {
  const result = await stopServerFromPidFile(pidFile);
  if (result.reason === 'pid-not-owned') {
    // A stale PID may have been reassigned to an unrelated process. Never
    // trade a local test restart for killing a process we did not launch.
    console.warn(`Ignoring unowned Harmony server PID file: ${pidFile}`);
  }
  fs.rmSync(pidFile, { force: true });
}

function runPrepareScript() {
  const prepareScript = path.join(
    projectRoot,
    'scripts/run-prepare-local-update-artifacts.js'
  );
  const result = spawnSync(process.execPath, [prepareScript], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: { ...process.env, E2E_PLATFORM: 'harmony' },
  });
  if (result.status !== 0) {
    throw new Error(
      `Failed to prepare harmony update artifacts, exit code: ${result.status}`
    );
  }
}

function startServer() {
  const serverScript = path.join(projectRoot, 'scripts/local-e2e-server.ts');
  fs.mkdirSync(artifactsRoot, { recursive: true });
  // Keep server output diagnosable: a silently dying server (e.g.
  // EADDRINUSE) otherwise only surfaces as an unexplained ready-timeout.
  const logFd = fs.openSync(
    path.join(artifactsRoot, 'server.harmony.log'),
    'a'
  );
  const child = spawn(resolveBunCommand(), [serverScript], {
    cwd: projectRoot,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, E2E_ASSET_PORT: String(PORT) },
  });
  child.unref();
  fs.closeSync(logFd);
  fs.writeFileSync(pidFile, String(child.pid));
}

function waitForServer(timeoutMs = 30000) {
  const start = Date.now();
  const url = `http://127.0.0.1:${PORT}/health`;
  return new Promise((resolve, reject) => {
    let settled = false;
    let retryTimer;

    const retry = () => {
      if (settled || retryTimer) {
        return;
      }
      if (Date.now() - start > timeoutMs) {
        settled = true;
        reject(new Error('Local artifacts server did not become ready.'));
        return;
      }
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        poll();
      }, 300);
    };

    const poll = () => {
      if (settled) {
        return;
      }
      let attemptFinished = false;
      const retryOnce = () => {
        if (attemptFinished) {
          return;
        }
        attemptFinished = true;
        retry();
      };
      const req = http.get(url, (res) => {
        // 必须消费响应体，否则成功探活也可能把 TCP 句柄留给 Jest 收尾。
        res.resume();
        if (attemptFinished || settled) {
          return;
        }
        attemptFinished = true;
        if (res.statusCode === 200) {
          settled = true;
          resolve();
          return;
        }
        retry();
      });
      req.once('error', retryOnce);
      req.setTimeout(1000, () => {
        req.destroy();
        retryOnce();
      });
    };
    poll();
  });
}

module.exports = async function globalSetup() {
  await killExistingServer();
  if (process.env.RNU_E2E_SKIP_PREPARE === 'true') {
    const manifest = path.join(artifactsRoot, 'harmony/manifest.json');
    if (!fs.existsSync(manifest)) {
      throw new Error(`Harmony update artifacts are missing: ${manifest}`);
    }
  } else {
    runPrepareScript();
  }
  startServer();
  await waitForServer();
};
