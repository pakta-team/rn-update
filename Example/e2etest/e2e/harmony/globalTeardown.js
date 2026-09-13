/**
 * [INPUT]: 依赖 Node 文件/进程 API、hdc 与 Harmony setup 写入的 pid 文件
 * [OUTPUT]: 对外提供 Harmony e2e 服务停止、reverse 端口撤销与临时状态清理 hook
 * [POS]: e2e/harmony 的平台全局 teardown，统一回收宿主和设备侧测试资源
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { stopServerFromPidFile } = require('./server-process');

const pidFile = path.resolve(
  __dirname,
  '../../.e2e-artifacts/.server.harmony.pid'
);
const HDC = process.env.HDC_PATH || 'hdc';
const PORT = 31337;

function removeReversePort() {
  const targetArgs = process.env.HDC_TARGET
    ? ['-t', process.env.HDC_TARGET]
    : [];
  const result = spawnSync(
    HDC,
    [...targetArgs, 'fport', 'rm', `tcp:${PORT}`, `tcp:${PORT}`],
    { encoding: 'utf8', windowsHide: true }
  );
  if (result.error) {
    throw result.error;
  }
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  if (
    result.status !== 0 ||
    (/\[Fail\]/i.test(output) && !/not exist/i.test(output))
  ) {
    throw new Error(`Failed to remove Harmony reverse port: ${output.trim()}`);
  }
}

module.exports = async function globalTeardown() {
  try {
    await stopServerFromPidFile(pidFile);
  } finally {
    fs.rmSync(pidFile, { force: true });
    removeReversePort();
  }
};
