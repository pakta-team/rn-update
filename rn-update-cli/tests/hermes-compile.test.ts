/**
 * [INPUT]: 依赖 Hermes bundle 编译编排、Hermes base 选择与临时文件原语
 * [OUTPUT]: 验证 base/plain 并行编译、等价校验失败降级与调试现场路径
 * [POS]: CLI bundle-runner 的 Hermes 编译回归防线，真实 hermesc 不存在时安全跳过编译场景
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import {
  compileHermesByteCode,
  hermesBaseErrorLogPath,
  startHermesBaseSelection,
} from '../src/bundle-runner';
import { getHbcVersion } from '../src/utils/hbcTransform';
import { probeHbcVersion } from '../src/utils/hermes-base';

// Same discovery as hermes-base.test.ts: HERMESC env or the SDK repo's hermesc.
const HERMESC_CANDIDATES = [
  path.resolve(
    __dirname,
    '../../rn-update/Example/testHotUpdate/node_modules/hermes-compiler/hermesc/osx-bin/hermesc',
  ),
  path.resolve(
    __dirname,
    '../../rn-update/.e2e-rn077-oldarch/AwesomeProject/node_modules/react-native/sdks/hermesc/osx-bin/hermesc',
  ),
];
const hermesc =
  process.env.HERMESC || HERMESC_CANDIDATES.find((p) => fs.existsSync(p));
const hasHermesc = Boolean(hermesc) && fs.existsSync(hermesc!);

const BASE_SRC = "var s = 'foo'; print(s, 'bar', 'baz'); var t = 'qux';\n";
const NEXT_SRC = `${BASE_SRC}var o = {}; o.foo = 1; o.bar = 2; print(o.foo, o.bar, o.qux, [1, 'new1', 'new2']);\n`;

describe.if(hasHermesc)('compileHermesByteCode with a base', () => {
  let dir: string;
  let outputFolder: string;
  let baseHbc: string;
  const previousCache = process.env.PAKTA_CACHE_DIR;
  const bundleName = 'index.bundlejs';

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rnu-hermes-compile-'));
    process.env.PAKTA_CACHE_DIR = path.join(dir, 'cache');
    outputFolder = path.join(dir, 'out');
    fs.ensureDirSync(outputFolder);
    fs.writeFileSync(path.join(outputFolder, bundleName), NEXT_SRC);
    const baseJs = path.join(dir, 'base.js');
    fs.writeFileSync(baseJs, BASE_SRC);
    baseHbc = path.join(dir, 'base.hbc');
    const status = spawnSync(
      hermesc!,
      ['-emit-binary', '-out', baseHbc, baseJs, '-O', '-w'],
      { stdio: 'ignore' },
    ).status;
    expect(status).toBe(0);
  });
  afterEach(() => {
    if (previousCache === undefined) delete process.env.PAKTA_CACHE_DIR;
    else process.env.PAKTA_CACHE_DIR = previousCache;
    fs.removeSync(dir);
  });

  // anything but the bundle and its hermes map is a leftover
  const leftovers = () =>
    fs
      .readdirSync(outputFolder)
      .filter((n) => n !== bundleName && n !== `${bundleName}.map`);

  test('verified base compile: plain compile runs alongside and is discarded', async () => {
    const result = await compileHermesByteCode({
      bundleName,
      outputFolder,
      sourcemapOutput: '',
      shouldCleanSourcemap: true,
      baseRequest: { option: baseHbc, verify: true },
      hermesCommand: hermesc!,
    });
    expect(result.base?.source).toBe('local');
    expect(result.verified).toBe(true);
    expect(result.outcome).toBe('used');
    expect(result.outcomeDetail).toBeUndefined();
    const out = fs.readFileSync(path.join(outputFolder, bundleName));
    expect(getHbcVersion(out)).toBe(result.bytecodeVersion);
    expect(fs.existsSync(path.join(outputFolder, `${bundleName}.map`))).toBe(
      true,
    );
    expect(leftovers()).toEqual([]);
  });

  test('unverified base compile skips the plain compile', async () => {
    const result = await compileHermesByteCode({
      bundleName,
      outputFolder,
      sourcemapOutput: '',
      shouldCleanSourcemap: true,
      baseRequest: { option: baseHbc, verify: false },
      hermesCommand: hermesc!,
    });
    expect(result.base?.source).toBe('local');
    expect(result.verified).toBeUndefined();
    // unverified but shipped with the base: still 'used'
    expect(result.outcome).toBe('used');
    expect(
      getHbcVersion(fs.readFileSync(path.join(outputFolder, bundleName))),
    ).toBe(result.bytecodeVersion);
    expect(leftovers()).toEqual([]);
  });

  test('a base hermesc rejects falls back to the concurrent plain compile', async () => {
    // right HBC version so the base is accepted, garbage after the header so
    // hermesc refuses it
    const version = probeHbcVersion(hermesc!)!;
    const bogus = path.join(dir, 'bogus.hbc');
    const buf = Buffer.alloc(256, 0xaa);
    Buffer.from('c61fbc03c103191f', 'hex').copy(buf, 0);
    buf.writeUInt32LE(version, 8);
    fs.writeFileSync(bogus, buf);
    const result = await compileHermesByteCode({
      bundleName,
      outputFolder,
      sourcemapOutput: '',
      shouldCleanSourcemap: true,
      baseRequest: { option: bogus, verify: true },
      hermesCommand: hermesc!,
    });
    expect(result.base).toBeNull();
    expect(result.verified).toBeUndefined();
    // the base compile itself failed: no base at all, with the reason
    expect(result.outcome).toBe('none');
    expect(result.outcomeDetail).toMatch(/^base compile failed: /);
    const out = fs.readFileSync(path.join(outputFolder, bundleName));
    expect(getHbcVersion(out)).toBe(version);
    // the plain compile's sourcemap took the real bundle's place
    expect(fs.existsSync(path.join(outputFolder, `${bundleName}.map`))).toBe(
      true,
    );
    // the full compiler output lands next to the intermediate dir, never in
    // it: everything inside is packed into the ppk
    const errorLog = hermesBaseErrorLogPath(outputFolder);
    expect(errorLog.startsWith(path.resolve(outputFolder))).toBe(false);
    expect(fs.existsSync(errorLog)).toBe(true);
    expect(leftovers()).toEqual([]);
  });

  test('a failed verification compile drops the base instead of shipping it unverified', async () => {
    // A wrapper that logs every invocation, fails only the plain compile into
    // `plain/` (the one the check needs) and defers everything else to the
    // real hermesc. It sits under a react-native/sdks/hermesc path because
    // the selection gates on the command's location.
    const wrapperDir = path.join(
      dir,
      'node_modules/react-native/sdks/hermesc/linux64-bin',
    );
    fs.ensureDirSync(wrapperDir);
    const wrapper = path.join(wrapperDir, 'hermesc');
    const calls = path.join(dir, 'hermesc-calls.log');
    fs.writeFileSync(
      wrapper,
      `#!/bin/sh
echo "$*" >> "${calls}"
case "$*" in *"/plain/"*) echo "simulated plain compile failure" >&2; exit 3;; esac
exec "${hermesc}" "$@"
`,
      { mode: 0o755 },
    );
    const result = await compileHermesByteCode({
      bundleName,
      outputFolder,
      sourcemapOutput: '',
      shouldCleanSourcemap: true,
      baseRequest: { option: baseHbc, verify: true },
      hermesCommand: wrapper,
    });
    // same policy as a dump that could not be read: base dropped, plain shipped
    expect(result.base).toBeNull();
    expect(result.verified).toBeUndefined();
    expect(result.outcome).toBe('dump-failed');
    expect(result.outcomeDetail).toBe('plain compile failed: exit 3');
    const out = fs.readFileSync(path.join(outputFolder, bundleName));
    expect(getHbcVersion(out)).toBe(probeHbcVersion(hermesc!)!);
    // three compiles: with the base, the failed check compile, and the plain
    // recompile that replaced the base output (no dump ever ran); the HBC
    // version probe compiles too, but into the temp dir
    const compiles = fs
      .readFileSync(calls, 'utf8')
      .trim()
      .split('\n')
      .filter(
        (line) => line.includes('-emit-binary') && line.includes(outputFolder),
      );
    expect(compiles).toHaveLength(3);
    // the first two run concurrently (either order); the recompile is last
    const concurrent = compiles.slice(0, 2);
    expect(concurrent.filter((c) => c.includes('-base-bytecode=')).length).toBe(
      1,
    );
    expect(concurrent.filter((c) => c.includes('/plain/')).length).toBe(1);
    expect(compiles[2]).not.toContain('-base-bytecode=');
    expect(compiles[2]).not.toContain('/plain/');
    expect(fs.readFileSync(calls, 'utf8')).not.toContain('-dump-bytecode');
    expect(leftovers()).toEqual([]);
  });

  test('a hanging base compile times out and reuses the successful plain compile', async () => {
    const wrapperDir = path.join(
      dir,
      'node_modules/react-native/sdks/hermesc/linux64-bin',
    );
    fs.ensureDirSync(wrapperDir);
    const wrapper = path.join(wrapperDir, 'hermesc');
    const calls = path.join(dir, 'deadline-calls');
    fs.writeFileSync(
      wrapper,
      `#!/bin/sh
echo "$*" >> "${calls}"
case "$*" in *-base-bytecode=*) exec "${process.execPath}" -e 'setInterval(() => {}, 1000)';; esac
exec "${hermesc}" "$@"
`,
      { mode: 0o755 },
    );
    const previous = process.env.PAKTA_HERMES_COMPILE_TIMEOUT_MS;
    process.env.PAKTA_HERMES_COMPILE_TIMEOUT_MS = '250';
    try {
      const result = await compileHermesByteCode({
        bundleName,
        outputFolder,
        sourcemapOutput: '',
        shouldCleanSourcemap: true,
        baseRequest: { option: baseHbc, verify: true },
        hermesCommand: wrapper,
      });
      expect(result.base).toBeNull();
      expect(result.outcomeDetail).toContain('base compile failed');
      expect(
        getHbcVersion(fs.readFileSync(path.join(outputFolder, bundleName))),
      ).toBe(probeHbcVersion(hermesc!)!);
      const compiles = fs
        .readFileSync(calls, 'utf8')
        .split('\n')
        .filter(
          (line) =>
            line.includes('-emit-binary') && line.includes(outputFolder),
        );
      expect(compiles).toHaveLength(2);
      expect(leftovers()).toEqual([]);
    } finally {
      if (previous === undefined)
        delete process.env.PAKTA_HERMES_COMPILE_TIMEOUT_MS;
      else process.env.PAKTA_HERMES_COMPILE_TIMEOUT_MS = previous;
    }
  }, 5000);

  test('an early speculative sourcemap rejection is observed before verification finishes', async () => {
    const wrapperDir = path.join(
      dir,
      'node_modules/react-native/sdks/hermesc/linux64-bin',
    );
    const scripts = path.join(dir, 'node_modules/react-native/scripts');
    fs.ensureDirSync(wrapperDir);
    fs.ensureDirSync(scripts);
    fs.writeJsonSync(path.join(dir, 'node_modules/react-native/package.json'), {
      name: 'react-native',
      version: '0.77.3',
    });
    const marker = path.join(dir, 'compose-attempted');
    // The discarded base's composer fails immediately. After verification
    // fails, composing the retained plain output must still succeed.
    fs.writeFileSync(
      path.join(scripts, 'compose-source-maps.js'),
      `
const fs = require('fs');
if (!fs.existsSync(${JSON.stringify(marker)})) {
  fs.writeFileSync(${JSON.stringify(marker)}, 'first');
  throw new Error('speculative composer failed');
}
fs.writeFileSync(process.argv[process.argv.indexOf('-o') + 1], '{}');
`,
    );
    const wrapper = path.join(wrapperDir, 'hermesc');
    fs.writeFileSync(
      wrapper,
      `#!/bin/sh
case "$*" in *-dump-bytecode*) sleep 0.25; exit 3;; esac
exec "${hermesc}" "$@"
`,
      { mode: 0o755 },
    );
    const map = path.join(outputFolder, `${bundleName}.map`);
    fs.writeFileSync(map, '{}');
    const child = spawnSync(
      process.execPath,
      [
        path.join(__dirname, 'fixtures/hermes-async-check.cjs'),
        JSON.stringify({
          operation: 'compile',
          modulePath: require.resolve('../src/bundle-runner'),
          cwd: dir,
          options: {
            bundleName,
            outputFolder,
            sourcemapOutput: map,
            shouldCleanSourcemap: true,
            baseRequest: { option: baseHbc, verify: true },
            hermesCommand: wrapper,
          },
        }),
      ],
      { encoding: 'utf8', timeout: 4000 },
    );
    expect(child.error).toBeUndefined();
    expect(child.signal).toBeNull();
    expect(child.status).toBe(0);
    expect(child.stderr).not.toContain('HERMES_ASYNC_ERROR');
    const line = child.stdout
      .split('\n')
      .find((value) => value.startsWith('HERMES_ASYNC_RESULT '));
    expect(line).toBeDefined();
    const result = JSON.parse(line!.slice('HERMES_ASYNC_RESULT '.length));
    expect(fs.existsSync(marker)).toBe(true);
    expect(result.outcome).toBe('dump-failed');
    expect(result.base).toBeNull();
    expect(fs.readFileSync(map, 'utf8')).toBe('{}');
    expect(leftovers()).toEqual([]);
  }, 5000);

  test('a selection started ahead of time is consumed by the compile', async () => {
    const pending = startHermesBaseSelection({
      option: baseHbc,
      verify: true,
    }).then((selection) => ({ ...selection, commandUnavailable: false }));
    // the runner resolves hermesc from the project; here that fails, so the
    // compile must fall back to selecting again with the injected command
    const unavailable = await startHermesBaseSelection({
      option: baseHbc,
      verify: true,
    });
    expect(unavailable.commandUnavailable).toBe(true);
    const result = await compileHermesByteCode({
      bundleName,
      outputFolder,
      sourcemapOutput: '',
      shouldCleanSourcemap: true,
      baseRequest: { option: baseHbc, verify: true },
      pendingBase: Promise.resolve(unavailable),
      hermesCommand: hermesc!,
    });
    expect(result.base?.source).toBe('local');
    expect(result.verified).toBe(true);
    expect(result.outcome).toBe('used');
    await pending;
  });
});

describe('hermesBaseDumpPaths', () => {
  test('is off unless PAKTA_HERMES_BASE_DEBUG is set to something truthy', async () => {
    const { hermesBaseDumpPaths } = await import('../src/bundle-runner');
    const out = path.join(os.tmpdir(), 'rnu-dump', 'intermedia', 'android');
    expect(hermesBaseDumpPaths(out, {})).toBeUndefined();
    expect(
      hermesBaseDumpPaths(out, { PAKTA_HERMES_BASE_DEBUG: '0' }),
    ).toBeUndefined();
    expect(
      hermesBaseDumpPaths(out, { PAKTA_HERMES_BASE_DEBUG: 'false' }),
    ).toBeUndefined();
    // next to the intermediate dir, never inside it (its content is packed)
    expect(hermesBaseDumpPaths(out, { PAKTA_HERMES_BASE_DEBUG: '1' })).toEqual({
      withBase: path.join(
        os.tmpdir(),
        'rnu-dump',
        'intermedia',
        'hermes-base-dump-base.txt',
      ),
      plain: path.join(
        os.tmpdir(),
        'rnu-dump',
        'intermedia',
        'hermes-base-dump-plain.txt',
      ),
    });
  });
});
