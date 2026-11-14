import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import * as api from '../src/api';
import { userCommands } from '../src/user';
import * as utils from '../src/utils';

describe('userCommands.login', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let postSpy: ReturnType<typeof spyOn>;
  let replaceSessionSpy: ReturnType<typeof spyOn>;
  let saveSessionSpy: ReturnType<typeof spyOn>;
  let questionSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    postSpy = spyOn(api, 'post').mockResolvedValue({
      token: 'session-token-abc',
      info: { name: 'TestUser', email: 'test@example.com' },
    });
    replaceSessionSpy = spyOn(api, 'replaceSession').mockImplementation(
      () => {},
    );
    saveSessionSpy = spyOn(api, 'saveSession').mockResolvedValue(undefined);
    questionSpy = spyOn(utils, 'question').mockResolvedValue('fallback');
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    postSpy.mockRestore();
    replaceSessionSpy.mockRestore();
    saveSessionSpy.mockRestore();
    questionSpy.mockRestore();
  });

  test('calls post with the canonical email/password contract', async () => {
    await userCommands.login({
      args: ['user@example.com', 'mypassword'],
    });

    expect(postSpy).toHaveBeenCalledWith('/auth/login', {
      email: 'user@example.com',
      password: 'mypassword',
    });
  });

  test('standalone login prefixes the management API path', async () => {
    const originalServiceURL = process.env.RNU_SERVICE_URL;
    process.env.RNU_SERVICE_URL = 'https://updates.example';
    try {
      await userCommands.login({
        args: ['User@Example.com', 'a-password-longer-than-twelve'],
      });

      expect(postSpy).toHaveBeenCalledWith('/admin/api/v1/auth/login', {
        email: 'User@Example.com',
        password: 'a-password-longer-than-twelve',
      });
    } finally {
      if (originalServiceURL === undefined) delete process.env.RNU_SERVICE_URL;
      else process.env.RNU_SERVICE_URL = originalServiceURL;
    }
  });

  test('calls replaceSession with the returned token', async () => {
    await userCommands.login({
      args: ['user@example.com', 'mypassword'],
    });

    expect(replaceSessionSpy).toHaveBeenCalledWith({
      token: 'session-token-abc',
    });
  });

  test('calls saveSession after replaceSession', async () => {
    await userCommands.login({
      args: ['user@example.com', 'mypassword'],
    });

    expect(saveSessionSpy).toHaveBeenCalled();
    expect(replaceSessionSpy).toHaveBeenCalled();

    // Verify call order: replaceSession should be called before saveSession
    const replaceOrder = replaceSessionSpy.mock.invocationCallOrder[0];
    const saveOrder = saveSessionSpy.mock.invocationCallOrder[0];
    expect(replaceOrder).toBeLessThan(saveOrder);
  });

  test('prompts for email and password when args are missing', async () => {
    let _callCount = 0;
    questionSpy.mockImplementation(async (prompt: string) => {
      _callCount++;
      if (prompt === 'email:') return 'asked@email.com';
      return 'asked-password';
    });

    await userCommands.login({ args: [] });

    expect(questionSpy).toHaveBeenCalledTimes(2);
    expect(postSpy).toHaveBeenCalledWith('/auth/login', {
      email: 'asked@email.com',
      password: 'asked-password',
    });
  });

  test('logs welcome message with user name', async () => {
    await userCommands.login({
      args: ['user@example.com', 'mypassword'],
    });

    expect(consoleSpy).toHaveBeenCalled();
    // The welcome message includes the user's name
    const logOutput = consoleSpy.mock.calls[0][0] as string;
    expect(logOutput).toContain('TestUser');
  });
});

describe('userCommands.logout', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let closeSessionSpy: ReturnType<typeof spyOn>;
  let postSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    closeSessionSpy = spyOn(api, 'closeSession').mockImplementation(() => {});
    postSpy = spyOn(api, 'post').mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    closeSessionSpy.mockRestore();
    postSpy.mockRestore();
  });

  test('calls closeSession', async () => {
    await userCommands.logout({} as any);

    expect(closeSessionSpy).toHaveBeenCalled();
  });

  test('logs a message after logout', async () => {
    await userCommands.logout({} as any);

    expect(consoleSpy).toHaveBeenCalled();
  });
});

describe('userCommands.me', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let getSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    getSpy = spyOn(api, 'get').mockResolvedValue({
      ok: true,
      name: 'TestUser',
      email: 'test@example.com',
      id: '12345',
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    getSpy.mockRestore();
  });

  /** servicePath may or may not carry the standalone prefix; match the route. */
  const requestedRoutes = () =>
    getSpy.mock.calls.map((c) => String(c[0]).replace(/^\/admin\/api\/v1/, ''));

  test('calls get with /auth/me', async () => {
    await userCommands.me();

    expect(requestedRoutes()).toContain('/auth/me');
  });

  test('combines identity and membership snapshot', async () => {
    await userCommands.me();

    expect(requestedRoutes()).toContain('/auth/me');
    expect(requestedRoutes()).toContain('/membership/me');
  });

  test('logs each field except "ok"', async () => {
    await userCommands.me();

    // Should log name, email, id but NOT ok
    const logCalls = consoleSpy.mock.calls.map((c) => c[0] as string);
    expect(logCalls).toContain('name: TestUser');
    expect(logCalls).toContain('email: test@example.com');
    expect(logCalls).toContain('id: 12345');

    // Should not log the "ok" field
    const hasOk = logCalls.some((msg) => msg.startsWith('ok:'));
    expect(hasOk).toBe(false);
  });

  test('skips the "ok" field when logging', async () => {
    await userCommands.me();

    const logCalls = consoleSpy.mock.calls.map((c) => c[0] as string);
    for (const msg of logCalls) {
      expect(msg).not.toMatch(/^ok:/);
    }
  });
});

describe('userCommands.login without credentials', () => {
  test('fails before calling the server when nothing can be prompted', async () => {
    // non-interactive `question` answers '' for both prompts
    const questionSpy = spyOn(utils, 'question').mockResolvedValue('');
    const postSpy = spyOn(api, 'post').mockResolvedValue({
      token: 'token',
      info: { name: 'user' },
    });
    try {
      await expect(userCommands.login({ args: [] })).rejects.toThrow(/login/);
      expect(postSpy).not.toHaveBeenCalled();
    } finally {
      questionSpy.mockRestore();
      postSpy.mockRestore();
    }
  });
});
