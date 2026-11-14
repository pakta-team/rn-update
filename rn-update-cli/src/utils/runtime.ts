/**
 * [INPUT]: 依赖 Node/Bun 子进程、HTTP agent、代理环境变量与包管理器运行时布局
 * [OUTPUT]: 对外提供代理感知请求、网络延迟探测、包管理器/JavaScript runtime 选择及进程启动函数
 * [POS]: CLI 跨运行时基础设施，统一网络和子进程行为，供 API、bundle 与安装命令复用
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import {
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
  type SpawnSyncOptions,
  spawn,
  spawnSync,
} from 'child_process';
import fs from 'fs';
import type { Agent as HttpAgent } from 'http';
import { createConnection } from 'net';
import path from 'path';
import type { Dispatcher } from 'undici';

export type RuntimeRequestInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  signal?: AbortSignal;
};

export type RuntimeResponse = {
  status: number;
  statusText: string;
  text: () => Promise<string>;
};

export type PackageManager = 'bun' | 'npm' | 'pnpm' | 'yarn';
export type JavaScriptRuntime = 'bun' | 'node';

export const isBunRuntime =
  typeof (process.versions as NodeJS.ProcessVersions & { bun?: string }).bun ===
  'string';

export function runtimeFetch(
  url: string,
  options?: RuntimeRequestInit,
): Promise<RuntimeResponse> {
  return webFetch(url, options as RequestInit) as Promise<RuntimeResponse>;
}

// ---------------------------------------------------------------------------
// proxies
//
// Node's built-in fetch ignores HTTP(S)_PROXY, so behind a corporate proxy or
// a VPN every request of the CLI used to fail with a connection error. Every
// network path (API, uploads, source map / Hermes base downloads, the registry
// version check) resolves its proxy here, with the conventions curl, npm and
// undici share: HTTPS_PROXY for https targets (falling back to HTTP_PROXY),
// HTTP_PROXY for http targets, NO_PROXY to exempt hosts.
// ---------------------------------------------------------------------------

function firstEnv(
  env: NodeJS.ProcessEnv,
  ...names: string[]
): string | undefined {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

/**
 * NO_PROXY: comma/space separated hosts; `*` exempts everything; a leading
 * `.` (or `*.`) matches sub-domains, a plain host matches itself and its
 * sub-domains, `host:port` only that port.
 */
function matchesNoProxy(target: URL, noProxy: string | undefined): boolean {
  if (!noProxy) return false;
  const host = target.hostname.toLowerCase();
  const port = target.port || (target.protocol === 'https:' ? '443' : '80');
  for (const raw of noProxy.split(/[\s,]+/)) {
    let entry = raw.trim().toLowerCase();
    if (!entry) continue;
    if (entry === '*') return true;
    let entryPort: string | undefined;
    const withPort = /^([^:]+):(\d+)$/.exec(entry);
    if (withPort) {
      entry = withPort[1];
      entryPort = withPort[2];
    }
    if (entryPort && entryPort !== port) continue;
    if (entry.startsWith('*.')) entry = entry.slice(1);
    if (entry.startsWith('.')) entry = entry.slice(1);
    if (host === entry || host.endsWith(`.${entry}`)) return true;
  }
  return false;
}

/**
 * The proxy url for `targetUrl` from the environment, or undefined for a
 * direct connection (no proxy configured, NO_PROXY exempts the host, or the
 * proxy is not an http(s) url).
 */
export function resolveProxy(
  targetUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  let target: URL;
  try {
    target = new URL(targetUrl);
  } catch {
    return undefined;
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return undefined;
  }
  const proxy =
    target.protocol === 'https:'
      ? firstEnv(env, 'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy')
      : firstEnv(env, 'HTTP_PROXY', 'http_proxy');
  if (!proxy || matchesNoProxy(target, firstEnv(env, 'NO_PROXY', 'no_proxy'))) {
    return undefined;
  }
  try {
    const parsed = new URL(proxy);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return proxy;
}

const proxyDispatchers = new Map<string, Dispatcher>();

/**
 * fetch with the WHATWG Response, through the environment's proxy when one
 * applies to `url`. The proxy path goes through undici's own fetch (Node's
 * built-in one cannot take a dispatcher), loaded only then.
 */
export function webFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const proxy = resolveProxy(url);
  if (proxy) {
    const undici = require('undici') as typeof import('undici');
    let dispatcher = proxyDispatchers.get(proxy);
    if (!dispatcher) {
      dispatcher = new undici.ProxyAgent(proxy);
      proxyDispatchers.set(proxy, dispatcher);
    }
    return undici.fetch(url, {
      ...(init as any),
      dispatcher,
    }) as unknown as Promise<Response>;
  }
  return globalThis.fetch(url, init);
}

const proxyAgents = new Map<string, HttpAgent>();

/**
 * An http.Agent routing `targetUrl` through its proxy, for the core
 * http/https APIs (including the streaming uploads); undefined when the
 * connection is direct. Always a CONNECT tunnel (also for http targets, like
 * undici's ProxyAgent above): the absolute-form alternative rewrites the
 * request head after it was buffered, which garbles a streaming body.
 */
export function proxyAgentFor(targetUrl: string): HttpAgent | undefined {
  const proxy = resolveProxy(targetUrl);
  if (!proxy) return undefined;
  let agent = proxyAgents.get(proxy);
  if (!agent) {
    const { HttpsProxyAgent } =
      require('https-proxy-agent') as typeof import('https-proxy-agent');
    agent = new HttpsProxyAgent(proxy);
    proxyAgents.set(proxy, agent);
  }
  return agent;
}

function resolveTcpTarget(input: string): { host: string; port: number } {
  try {
    const parsed = new URL(input);
    const port = parsed.port || (parsed.protocol === 'http:' ? '80' : '443');
    return {
      host: parsed.hostname,
      port: Number(port),
    };
  } catch {
    const [host, port] = input.split(':');
    return {
      host,
      port: port ? Number(port) : 443,
    };
  }
}

function measureTcpConnectOnce(
  host: string,
  port: number,
  timeout: number,
): Promise<number> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const socket = createConnection({ host, port });

    const finish = (latency: number) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(latency);
    };

    socket.setTimeout(timeout);
    socket.once('connect', () => {
      finish(Date.now() - startedAt);
    });
    socket.once('timeout', () => {
      finish(Number.POSITIVE_INFINITY);
    });
    socket.once('error', () => {
      finish(Number.POSITIVE_INFINITY);
    });
  });
}

export async function measureTcpLatency(
  input: string,
  {
    attempts = 4,
    timeout = 1000,
  }: {
    attempts?: number;
    timeout?: number;
  } = {},
): Promise<number> {
  const { host, port } = resolveTcpTarget(input);
  const promises = Array.from({ length: attempts }, () =>
    measureTcpConnectOnce(host, port, timeout),
  );
  const results = await Promise.all(promises);
  const latencies = results.filter(Number.isFinite);

  if (latencies.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  return (
    latencies.reduce((sum, latency) => sum + latency, 0) / latencies.length
  );
}

export function detectPackageManager(
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): PackageManager {
  const lockFiles: Array<[string, PackageManager]> = [
    ['bun.lock', 'bun'],
    ['bun.lockb', 'bun'],
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm'],
  ];
  for (const [lockFile, manager] of lockFiles) {
    if (fs.existsSync(path.join(cwd, lockFile))) {
      return manager;
    }
  }

  const userAgent = env.npm_config_user_agent ?? '';
  if (userAgent.startsWith('bun/')) {
    return 'bun';
  }
  if (userAgent.startsWith('pnpm/')) {
    return 'pnpm';
  }
  if (userAgent.startsWith('yarn/')) {
    return 'yarn';
  }
  if (userAgent.startsWith('npm/')) {
    return 'npm';
  }

  return isBunRuntime ? 'bun' : 'npm';
}

export function getInstallCommand(
  installArgs: string[],
  cwd = process.cwd(),
): { command: string; args: string[] } {
  const packageManager = detectPackageManager(cwd);
  if (packageManager === 'npm') {
    return { command: 'npm', args: ['install', ...installArgs] };
  }
  return { command: packageManager, args: ['add', ...installArgs] };
}

export function getJavaScriptRuntime(
  env: NodeJS.ProcessEnv = process.env,
): JavaScriptRuntime {
  const configured = env.RNU_JS_RUNTIME?.toLowerCase();
  if (configured === 'bun') {
    return 'bun';
  }
  if (configured === 'auto') {
    return isBunRuntime ? 'bun' : 'node';
  }
  return 'node';
}

export function spawnJavaScript(
  args: string[],
  options?: SpawnOptionsWithoutStdio,
  env: NodeJS.ProcessEnv = process.env,
): ChildProcessWithoutNullStreams {
  return spawn(getJavaScriptRuntime(env), args, options ?? {});
}

export function spawnJavaScriptSync(
  args: string[],
  options?: SpawnSyncOptions,
  env: NodeJS.ProcessEnv = process.env,
) {
  return spawnSync(getJavaScriptRuntime(env), args, options ?? {});
}
