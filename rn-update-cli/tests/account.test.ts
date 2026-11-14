import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import * as childProcess from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs';
import {
  accountCacheFile,
  printAccountInfo,
  showCurrentAccount,
} from '../src/account';
import * as api from '../src/api';

const now = Date.parse('2026-09-17T00:00:00Z');
const day = 86400000;
let log: ReturnType<typeof spyOn>;
let warn: ReturnType<typeof spyOn>;
let get: ReturnType<typeof spyOn>;
let session: ReturnType<typeof spyOn>;
let fork: ReturnType<typeof spyOn>;
let read: ReturnType<typeof spyOn>;
let worker: any;

beforeEach(() => {
  worker = Object.assign(new EventEmitter(), {
    send() {},
    unref() {},
    channel: { unref() {} },
  });
  fork = spyOn(childProcess, 'fork').mockReturnValue(worker);
  read = spyOn(fs, 'readFileSync').mockImplementation(() => {
    throw new Error('no cache');
  });
  log = spyOn(console, 'log').mockImplementation(() => {});
  warn = spyOn(console, 'warn').mockImplementation(() => {});
  get = spyOn(api, 'get').mockResolvedValue({});
  session = spyOn(api, 'getSession').mockReturnValue({ token: 'test-token' });
});
afterEach(() => {
  fork.mockRestore();
  read.mockRestore();
  log.mockRestore();
  warn.mockRestore();
  get.mockRestore();
  session.mockRestore();
});

for (const days of [0, 1, 29, 29.99, 30, 31, -1]) {
  test(`renewal boundary: ${days} days`, () => {
    printAccountInfo(
      {
        email: 'test@example.com',
        planCode: 'pro',
        planExpiresAt: new Date(now + days * day).toISOString(),
      },
      now,
    );
    expect(warn).toHaveBeenCalledTimes(days >= 0 && days < 30 ? 1 : 0);
    expect(log.mock.calls[0][0]).toContain('test@example.com');
    expect(log.mock.calls[0][0]).toContain('pro');
    expect(log.mock.calls[0][0]).toContain(
      new Date(now + days * day).toISOString(),
    );
  });
}

test('free accounts and accounts without a plan never receive reminders', () => {
  const planExpiresAt = new Date(now + day).toISOString();
  printAccountInfo({ planCode: 'free', planExpiresAt }, now);
  printAccountInfo({ planExpiresAt }, now);
  expect(warn).not.toHaveBeenCalled();
});

test('missing and invalid expiry dates never produce renewal reminders', () => {
  for (const planExpiresAt of [undefined, null, '', 'invalid']) {
    printAccountInfo({ planCode: 'pro', planExpiresAt }, now);
  }
  expect(warn).not.toHaveBeenCalled();
});

test('without a local session no refresh is started', () => {
  session.mockReturnValue(undefined);
  showCurrentAccount();
  expect(fork).not.toHaveBeenCalled();
  expect(get).not.toHaveBeenCalled();
});

test('refresh starts without awaiting the network', () => {
  expect(showCurrentAccount()).toBeUndefined();
  expect(fork).toHaveBeenCalledTimes(1);
  expect(get).not.toHaveBeenCalled();
  worker.emit('message', {
    account: { email: 'fresh@example.com' },
    fetchedAt: Date.now(),
  });
  expect(log.mock.calls[0][0]).toContain('fresh@example.com');
});

test('cached result displays immediately and is not printed twice', () => {
  read.mockReturnValue(
    JSON.stringify({
      account: { email: 'cached@example.com' },
      fetchedAt: Date.now(),
    }),
  );
  showCurrentAccount();
  expect(log.mock.calls[0][0]).toContain('cached@example.com');
  worker.emit('message', {
    account: { email: 'fresh@example.com' },
    fetchedAt: Date.now(),
  });
  expect(log).toHaveBeenCalledTimes(1);
});

test('worker failures do not block the command', () => {
  fork.mockImplementation(() => {
    throw new Error('spawn failed');
  });
  expect(showCurrentAccount()).toBeUndefined();
});

test('cache keys isolate credentials and never contain tokens', () => {
  expect(accountCacheFile('one')).not.toBe(accountCacheFile('two'));
  expect(accountCacheFile('one', 'api')).not.toBe(accountCacheFile('one'));
  expect(accountCacheFile('secret-token')).not.toContain('secret-token');
  expect(accountCacheFile('one')).toContain('pakta-cli');
});
