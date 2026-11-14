/**
 * [INPUT]: 依赖 api 的 getSession/getApiToken、child_process 的 fork、hash 的 sha256Hex、constants 的 pricingPageUrl 与 i18n 的 t
 * [OUTPUT]: 对外提供 AccountInfo 类型、printAccountInfo 账号摘要打印、accountCacheFile 缓存路径与 showCurrentAccount 缓存优先后台刷新
 * [POS]: CLI 账号状态展示层，被 bin（命令前置提醒）与 user.me（显式查询）消费；网络请求下沉到 account-worker 隔离进程
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import chalk from 'chalk';
import { fork } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getApiToken, getSession } from './api';
import { pricingPageUrl } from './utils/constants';
import { sha256Hex } from './utils/hash';
import { t } from './utils/i18n';

export interface AccountInfo {
  name?: string;
  email?: string;
  planCode?: string;
  planExpiresAt?: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function printAccountInfo(account: AccountInfo, now = Date.now()) {
  const expiresAt = account.planExpiresAt
    ? Date.parse(account.planExpiresAt)
    : NaN;
  const remaining = expiresAt - now;
  console.log(
    t('accountSummary', {
      account: account.email || account.name || t('accountUnknown'),
      tier: account.planCode || t('accountUnknown'),
      expiry: Number.isFinite(expiresAt)
        ? new Date(expiresAt).toISOString()
        : t('accountNoExpiry'),
    }),
  );
  if (
    account.planCode &&
    account.planCode !== 'free' &&
    remaining >= 0 &&
    remaining < 30 * DAY_MS
  ) {
    console.warn(
      chalk.yellow.bold(
        t('accountRenewalWarning', {
          days: Math.ceil(remaining / DAY_MS),
          url: pricingPageUrl,
        }),
      ),
    );
  }
}

interface AccountCache {
  account: AccountInfo;
  fetchedAt: number;
}

export function accountCacheFile(token: string, apiToken = '') {
  const key = sha256Hex(JSON.stringify([process.cwd(), token, apiToken]));
  return path.join(
    os.homedir(),
    '.cache',
    'pakta-cli',
    'accounts',
    `${key}.json`,
  );
}

/** Cache first; the detached refresh never keeps the command process alive. */
export function showCurrentAccount() {
  const token = getSession()?.token;
  if (!token) return;
  const apiToken = getApiToken();
  const cacheFile = accountCacheFile(token, apiToken);
  let cached = false;
  try {
    const entry: AccountCache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (
      entry.account &&
      typeof entry.account === 'object' &&
      Number.isFinite(entry.fetchedAt)
    ) {
      printAccountInfo(entry.account);
      cached = true;
    }
  } catch {
    // Missing or corrupt cache is a cache miss.
  }
  try {
    const worker = fork(
      path.join(__dirname, `account-worker${path.extname(__filename)}`),
      [],
      {
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        execArgv: [],
      },
    );
    worker.on('error', () => {});
    worker.on('message', (entry: AccountCache) => {
      if (!cached) {
        printAccountInfo(entry.account);
        cached = true;
      }
    });
    worker.send({ token, apiToken, cacheFile }, () => {});
    worker.unref();
    worker.channel?.unref();
  } catch {
    // Starting a background worker is also best effort.
  }
}
