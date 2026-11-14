/**
 * [INPUT]: 依赖 api 的 get/replaceSession/setApiToken/servicePath/unwrapData 与 fs/path 的原子写
 * [OUTPUT]: 以独立进程运行，向父进程回传 MembershipSnapshot 展平结果并落盘账号缓存
 * [POS]: account.ts 的后台刷新器，require.main 守卫隔离；DNS 与端点探测的迟滞不会阻塞命令进程
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from 'fs';
import path from 'path';
import {
  get,
  replaceSession,
  servicePath,
  setApiToken,
  unwrapData,
} from './api';

// Isolated from the command: even DNS, endpoint probing and slow sockets cannot
// keep the CLI alive. Bound the detached worker's lifetime as well.
if (require.main === module) {
  const deadline = setTimeout(() => process.exit(0), 15000);
  process.once(
    'message',
    async (input: { token: string; apiToken?: string; cacheFile: string }) => {
      try {
        replaceSession({ token: input.token });
        if (input.apiToken) setApiToken(input.apiToken);
        const snapshot = unwrapData<{
          plan?: { code?: string };
          expiresAt?: string | null;
        }>(await get(servicePath('/membership/me')));
        const account = {
          planCode: snapshot?.plan?.code,
          planExpiresAt: snapshot?.expiresAt ?? null,
        };
        const entry = { account, fetchedAt: Date.now() };
        fs.mkdirSync(path.dirname(input.cacheFile), {
          recursive: true,
          mode: 0o700,
        });
        const temporary = `${input.cacheFile}.${process.pid}.tmp`;
        fs.writeFileSync(temporary, JSON.stringify(entry), { mode: 0o600 });
        fs.renameSync(temporary, input.cacheFile);
        if (process.connected) {
          process.send?.(entry, () => process.exit(0));
          return;
        }
      } catch {
        // Background refresh is best effort; retain the last successful cache.
      }
      clearTimeout(deadline);
      process.exit(0);
    },
  );
}
