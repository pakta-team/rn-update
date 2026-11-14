/**
 * [INPUT]: 依赖 CLI API 会话存储、凭据隔离、账号摘要打印、登录提示与本地化文案
 * [OUTPUT]: 对外提供 login/logout/me 用户命令，me 汇总身份与会员快照并打印套餐状态
 * [POS]: CLI 身份层，所有服务地址统一走邮箱账号管理 API，并复用现有会话与令牌传输协议
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { printAccountInfo } from './account';
import {
  closeSession,
  get,
  post,
  replaceSession,
  saveSession,
  servicePath,
  unwrapData,
} from './api';
import type { CommandContext } from './types';
import { question } from './utils';
import { addGitIgnore } from './utils/add-gitignore';
import { scriptName } from './utils/constants';
import { t } from './utils/i18n';

export const userCommands = {
  login: async ({ args }: { args: string[] }) => {
    const email = args[0] || (await question('email:'));
    const pwd = args[1] || (await question('password:', true));
    if (!email || !pwd) {
      // without a terminal `question` answers '': fail here instead of
      // sending empty credentials to the server
      throw new Error(t('loginCredentialsRequired', { scriptName }));
    }
    const response = await post(servicePath('/auth/login'), {
      email,
      password: pwd,
    });
    const data = response?.data ?? response;
    const token = data?.accessToken ?? data?.token;
    if (typeof token !== 'string' || token.length === 0) {
      throw new Error(t('accessTokenMissing'));
    }
    replaceSession({ token });
    await saveSession();
    // make sure the token file is ignored before the user's next commit,
    // not only when they first run `bundle`
    addGitIgnore();
    console.log(
      t('welcomeMessage', {
        name:
          data?.user?.displayName ||
          data?.user?.email ||
          data?.info?.name ||
          email,
      }),
    );
  },
  logout: async (_context: CommandContext) => {
    await post(servicePath('/auth/logout')).catch(() => undefined);
    await closeSession();
    console.log(t('loggedOut'));
  },
  me: async () => {
    const me = unwrapData(await get(servicePath('/auth/me')));
    const membership = unwrapData(await get(servicePath('/membership/me')));
    printAccountInfo({
      name: me?.name,
      email: me?.email,
      planCode: membership?.plan?.code,
      planExpiresAt: membership?.expiresAt,
    });
    for (const k in me) {
      if (k !== 'ok') {
        console.log(`${k}: ${me[k]}`);
      }
    }
  },
};
