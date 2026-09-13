#!/usr/bin/env node
/**
 * [INPUT]: 依赖 Node child_process 与 e2etest 的 npm start 脚本，可接受平台标签但不改变 Metro 参数
 * [OUTPUT]: 启动并托管 Metro 子进程，转发终止信号并以子进程退出码结束
 * [POS]: e2etest 的跨平台 Metro 生命周期边界，供 Detox 调试配置复用，替代仅能由 Unix shell 执行的 start-rn.sh
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const http = require('node:http');
const { spawn } = require('node:child_process');

const METRO_PORT = Number(process.env.METRO_PORT || 8081);

const isMetroReady = () =>
  new Promise((resolve) => {
    const request = http.get(
      { hostname: '127.0.0.1', port: METRO_PORT, path: '/status' },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          resolve(
            response.statusCode === 200 &&
              body.includes('packager-status:running')
          );
        });
      }
    );
    request.setTimeout(1000, () => {
      request.destroy();
      resolve(false);
    });
    request.on('error', () => resolve(false));
  });

const holdProcess = () => {
  const timer = setInterval(() => {}, 1000);
  const stop = () => {
    clearInterval(timer);
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
};

const start = async () => {
  if (await isMetroReady()) {
    console.log(`Reusing Metro already listening on ${METRO_PORT}`);
    holdProcess();
    return;
  }

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const metro = spawn(npm, ['start'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  const forwardSignal = (signal) => {
    if (!metro.killed) {
      metro.kill(signal);
    }
  };

  process.once('SIGINT', () => forwardSignal('SIGINT'));
  process.once('SIGTERM', () => forwardSignal('SIGTERM'));

  metro.once('error', (error) => {
    console.error(error.message);
    process.exit(1);
  });

  metro.once('exit', (code) => {
    process.exit(code ?? 1);
  });
};

start().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
