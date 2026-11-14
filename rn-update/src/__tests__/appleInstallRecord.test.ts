import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function readApple(name: string): string {
  return readFileSync(
    new URL(`../../ios/RCTPakta/${name}`, import.meta.url),
    'utf8'
  ).replace(/^#include "(RCTPakta[^"/]+\.inc)"$/gm, (_, file) =>
    readApple(file)
  );
}

const source = readApple('RCTPakta.mm');
const commit = source.match(
  /^\+ \(BOOL\)commitRoundWithGeneration:[^;{]*\{[\s\S]*?^\}/gm
);
if (commit?.length !== 1) throw new Error('Missing unique production commit');
const body = commit[0]
  .replace(
    /^[\s\S]*?activatedOut \{/,
    'function commit(generation, hashInfoEntry, hashToActivate, responseText, requestBody, configJson, responseAtSeconds, activatedOut) {'
  )
  .replace(/\/\/[^\n]*/g, '')
  .replace(/pakta::install_record::Activation passed;/g, 'let passed = {};')
  .replace(
    /pakta::patch::Status activationStatus = pakta::patch::Status::Ok\(\);/,
    'let activationStatus = {ok: true};'
  )
  .replace(/pakta::install_record::CheckActivation/g, 'check')
  .replace(/pakta::install_record::Unchanged/g, 'unchanged')
  .replace(/&passed/g, 'passed')
  .replace(/PaktaToStdString\(/g, '(')
  .replace(
    /\[\[RCTPakta downloadDir\] stringByAppendingPathComponent:(\w+)\]/g,
    'join($1)'
  )
  .replace(/@\{([\s\S]*?)\}/g, '({$1})')
  .replace(/@\(responseAtSeconds\)/g, 'responseAtSeconds')
  .replace(
    /(?:__block BOOL |NSData \*|NSString \*|NSDictionary \*|NSMutableDictionary \*|NSUserDefaults \*)/g,
    'let '
  )
  .replace(/PaktaWithStateLock\(\^\{/g, 'lock(() => {')
  .replace(/\[info mutableCopy\]/g, '({...info})')
  .replace(
    /\[NSJSONSerialization dataWithJSONObject:(\w+)\s+options:0\s+error:nil\]/g,
    'JSON.stringify($1)'
  )
  .replace(
    /\[defaults setObject:\[\[NSString alloc\] initWithData:(\w+) encoding:NSUTF8StringEncoding\]\s+forKey:([^;]+)\];/g,
    'write($2, $1);'
  )
  .replace(/hashInfoEntry\[@"(\w+)"\]/g, 'hashInfoEntry?.["$1"]')
  .replace(/\*activatedOut = activated;/g, 'activatedOut.value = activated;')
  .replace(/@YES/g, 'true')
  .replace(/@"/g, '"')
  .replace(/\b(?:nil|NULL)\b/g, 'null')
  .replace(/\bYES\b/g, 'true')
  .replace(/\bNO\b/g, 'false');

function harness() {
  const state = {
    generation: 7,
    purge: false,
    window: true,
    crash: false,
    valid: true,
    changed: false,
    locked: false,
    mutate: false,
  };
  const writes: string[] = [];
  const calls: string[] = [];
  const module = runInNewContext(`${body}\ncommit`, {
    BUNDLE_FILE_NAME: 'index.bundlejs',
    paktaResetGeneration: { load: () => state.generation },
    paktaPurgeRestoreActive: { load: () => state.purge },
    get paktaPurgeRestoreWindowOpen() {
      return state.window;
    },
    paktaCrashRescueActive: { load: () => state.crash },
    join: (hash: string) => `/updates/${hash}`,
    check: (
      _dir: string,
      _hash: string,
      _name: string,
      grandfathered: boolean
    ) => {
      expect(state.locked).toBe(false);
      expect(grandfathered).toBe(false);
      calls.push('check');
      return { ok: state.valid };
    },
    unchanged: () => {
      expect(state.locked).toBe(true);
      calls.push('unchanged');
      return !state.changed;
    },
    lock: (fn: () => void) => {
      state.locked = true;
      if (state.mutate) state.changed = true;
      try {
        fn();
      } finally {
        state.locked = false;
      }
    },
    PaktaDefaults: () => ({}),
    PaktaHashInfoKey: () => 'info',
    keyNativeCheckCache: 'cache',
    write: (key: string) => {
      expect(state.locked).toBe(true);
      writes.push(key);
    },
    PaktaSwitchVersionLocked: () => {
      expect(state.locked).toBe(true);
      writes.push('state');
    },
  }) as (...args: unknown[]) => boolean;
  return {
    state,
    calls,
    writes,
    run(response: string | null = '{}', hash: string | null = 'abc') {
      const out = { value: true };
      const committed = module(
        7,
        { hash: 'abc', info: {} },
        hash,
        response,
        '{}',
        '{}',
        1,
        out
      );
      return { committed, activated: out.value };
    },
  };
}

describe('Apple production commit extraction, shared IO seam', () => {
  for (const response of ['{}', null]) {
    test(`snapshot change rejects all writes ${response}`, () => {
      const h = harness();
      h.state.mutate = true;
      expect(h.run(response)).toEqual({ committed: false, activated: false });
      expect(h.calls).toEqual(['check', 'unchanged']);
      expect(h.writes).toEqual([]);
    });
    test(`invalid digest rejects all writes ${response}`, () => {
      const h = harness();
      h.state.valid = false;
      expect(h.run(response)).toEqual({ committed: false, activated: false });
      expect(h.writes).toEqual([]);
    });
    test(`successful commit ${response}`, () => {
      const h = harness();
      expect(h.run(response)).toEqual({ committed: true, activated: true });
      expect(h.writes).toEqual(
        response === null ? ['info', 'state'] : ['info', 'state', 'cache']
      );
    });
  }
  test('stale generation has zero writes', () => {
    const h = harness();
    h.state.generation++;
    expect(h.run()).toEqual({ committed: false, activated: false });
    expect(h.writes).toEqual([]);
  });
  test('closed tvOS window preserves metadata even with invalid installation', () => {
    const h = harness();
    h.state.purge = true;
    h.state.window = false;
    h.state.valid = false;
    expect(h.run()).toEqual({ committed: true, activated: false });
    expect(h.writes).toEqual(['info', 'cache']);
    expect(h.calls).toEqual(['check']);
  });
  test('crash rescue cannot bypass a closed-window digest failure', () => {
    const h = harness();
    h.state.purge = true;
    h.state.window = false;
    h.state.crash = true;
    h.state.valid = false;
    expect(h.run()).toEqual({ committed: false, activated: false });
    expect(h.writes).toEqual([]);
  });
  test('cache-only has no disk dependency', () => {
    const h = harness();
    expect(h.run('{}', null)).toEqual({ committed: true, activated: false });
    expect(h.calls).toEqual([]);
  });
  test('shared install and archive production calls remain wired', () => {
    for (const name of [
      'Read',
      'HasRecordFile',
      'IsComplete',
      'Seal',
      'Promote',
      'CheckActivation',
      'Unchanged',
    ]) {
      expect(source).toContain(`pakta::install_record::${name}`);
    }
    expect(source).toContain('pakta::patch::ParsePatchManifest(');
    expect(source).toContain(
      'options.bundle_hbc_transform_meta = hbcTransform;'
    );
    expect(source).toContain('pakta::archive_limits::CheckExtractedDirectory(');
    expect(source).toContain('_entries.Accept(');
  });
  test('public switch rechecks current/last authority and generation under the lock', () => {
    const begin = source.lastIndexOf('- (BOOL)switchVersion:');
    const end = source.indexOf('- (BOOL)ensureDirectoryExistsAtPath:', begin);
    const body = source.slice(begin, end);
    expect(body).toContain(
      'grandfathered = state.current_version == target || state.last_version == target;'
    );
    expect(body).toContain(
      'BOOL legacyActivated = state.current_version == hashStd || state.last_version == hashStd;'
    );
    expect(body).toContain('paktaResetGeneration.load() != generation');
    expect(body).toMatch(/Unchanged\([\s\S]*legacyActivated, passed\)/);
    expect(body.indexOf('CheckActivation(')).toBeLessThan(
      body.lastIndexOf('PaktaWithStateLock(')
    );
    expect(body.indexOf('Unchanged(')).toBeLessThan(
      body.indexOf('PaktaSwitchVersionLocked(hash)')
    );
  });
});
