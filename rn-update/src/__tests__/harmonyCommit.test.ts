import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = new Bun.Transpiler({ loader: 'ts' }).transformSync(
  readFileSync(
    new URL(
      '../../harmony/pakta/src/main/ets/UpdateContext.ts',
      import.meta.url
    ),
    'utf8'
  )
    .replace(/^import[\s\S]*?;\r?\n/gm, '')
    .replace(/^export\s*\{[^}]*\}[^;]*;\r?\n/gm, '')
    .replace(/^export /gm, '')
);

function harness() {
  const writes: string[] = [];
  let valid = true;
  let verifying: () => Promise<object> = async () => ({});
  const context = runInNewContext(
    `${source}\nconst store = Object.create(UpdateContext.prototype); store.moveGeneration = () => { UpdateContext.resetGeneration++; UpdateContext.nativeConfigGeneration++; }; store;`,
    {
      KEY_RESP_CACHE: 'nativeCheckResp',
      assertSafePathComponent: (hash: string) => hash,
      logger: { error() {} },
      getErrorMessage: (error: Error) => error.message,
      toUpdateError: (error: Error) => error,
      ERROR_SWITCH_VERSION_FAILED: 'SWITCH_VERSION_FAILED',
      NativePatchCore: {
        installActivationUnchanged: () => {
          writes.push('snapshot');
          if (!valid) throw new Error('snapshot changed');
        },
      },
    }
  );
  context.taskChain = Promise.resolve();
  context.preferences = { putSync: (key: string) => writes.push(key) };
  context.beginFlushBatch = () => {};
  context.endFlushBatch = async () => {
    writes.push('flush');
  };
  context.applySwitch = () => writes.push('switch');
  context.verifyActivation = () => verifying();
  return {
    context,
    writes,
    invalidate: () => {
      valid = false;
    },
    verify: (fn: () => Promise<object>) => {
      verifying = fn;
    },
  };
}

test('Harmony commit holds the file queue through digest, snapshot and adjacent writes', async () => {
  const h = harness();
  let release!: (value: object) => void;
  h.verify(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  const commit = h.context.commitNativeCheckResult(
    0,
    'hash',
    '{}',
    true,
    '{}',
    0
  );
  const cleanup = h.context.enqueueSerialTask(async () =>
    h.writes.push('cleanup')
  );
  await Promise.resolve();
  expect(h.writes).toEqual([]);
  release({});
  expect(await commit).toBe(true);
  await cleanup;
  expect(h.writes).toEqual([
    'snapshot',
    'hash_hash',
    'switch',
    'nativeCheckResp',
    'flush',
    'cleanup',
  ]);
});

test('Harmony changed activation snapshot rejects without metadata/cache/state writes', async () => {
  const h = harness();
  h.invalidate();
  await expect(
    h.context.commitNativeCheckResult(0, 'hash', '{}', true, '{}', 0)
  ).rejects.toThrow('snapshot changed');
  expect(h.writes).toEqual(['snapshot']);
});

test('Harmony config generation rejects cache-only commit without writes', async () => {
  const h = harness();
  expect(
    await h.context.commitNativeCheckResult(0, '', '', false, '{}', 1)
  ).toBe(false);
  expect(h.writes).toEqual([]);
});

test('Harmony generations changed during digest reject before snapshot or writes', async () => {
  const h = harness();
  h.verify(async () => {
    h.context.moveGeneration();
    return {};
  });
  expect(
    await h.context.commitNativeCheckResult(0, 'hash', '{}', true, '{}', 0)
  ).toBe(false);
  expect(h.writes).toEqual([]);
});

test('Harmony public switch is serialized with cleanup and rechecks its snapshot', async () => {
  const h = harness();
  h.context.flushPreferences = async () => h.writes.push('flush');
  h.context.verifyActivation = async () => ({});
  h.invalidate();
  const commit = h.context.switchVersion('hash');
  await expect(commit).rejects.toThrow();
  await h.context.enqueueSerialTask(async () => h.writes.push('recovered'));
  expect(h.writes).toEqual(['snapshot', 'recovered']);
});
