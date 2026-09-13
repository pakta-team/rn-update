/**
 * [INPUT]: 依赖 Node 进程/文件 API、Windows PowerShell 或 POSIX ps/proc
 * [OUTPUT]: 对外提供 Harmony 本地 e2e server 的 PID 归属校验与安全停止能力
 * [POS]: e2e/harmony 全局 hook 共用的进程生命周期边界，拒绝误杀复用 PID 的无关进程
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

function readProcessCommandLine(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return '';
  }

  if (process.platform === 'win32') {
    const filter = `ProcessId = ${pid}`;
    for (const command of ['powershell.exe', 'pwsh.exe']) {
      const result = spawnSync(
        command,
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `(Get-CimInstance Win32_Process -Filter '${filter}').CommandLine`,
        ],
        { encoding: 'utf8', windowsHide: true }
      );
      if (result.status === 0 && result.stdout) {
        return result.stdout.trim();
      }
    }
    return '';
  }

  try {
    return fs
      .readFileSync(`/proc/${pid}/cmdline`, 'utf8')
      .replaceAll('\0', ' ');
  } catch {
    const result = spawnSync('ps', ['-p', String(pid), '-o', 'command='], {
      encoding: 'utf8',
    });
    return result.status === 0 ? result.stdout.trim() : '';
  }
}

function isHarmonyServerProcess(pid) {
  const commandLine = readProcessCommandLine(pid);
  return /(?:^|[\\/\s"'])local-e2e-server(?:\.[^\s"']+)?(?:$|[\\/\s"'])/i.test(
    commandLine
  );
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stopServerFromPidFile(pidFile, timeoutMs = 5000) {
  if (!fs.existsSync(pidFile)) {
    return { stopped: false, reason: 'missing-pid-file' };
  }

  const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
  if (!Number.isInteger(pid) || pid <= 0 || !isHarmonyServerProcess(pid)) {
    return { stopped: false, reason: 'pid-not-owned' };
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return { stopped: !isProcessAlive(pid), reason: 'already-gone' };
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return { stopped: true, reason: 'terminated' };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return { stopped: !isProcessAlive(pid), reason: 'termination-timeout' };
}

module.exports = {
  isHarmonyServerProcess,
  readProcessCommandLine,
  stopServerFromPidFile,
};
