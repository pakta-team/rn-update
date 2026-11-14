/**
 * [INPUT]: 依赖 Hermes base 解析/缓存/等价校验原语、ZIP fixture 与 Bun 测试运行时
 * [OUTPUT]: 验证 base 选择、缓存、二进制字面量校验、失败语义与发布元数据
 * [POS]: CLI Hermes base 行为回归防线，覆盖结构变化但不连接真实服务
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { ZipFile } from 'yazl';
import { sha256Hex } from '../src/utils/hash';
import {
  cacheDir,
  cacheLookup,
  cachePut,
  cacheStats,
  classifyHermesCommand,
  cleanCache,
  cleanStaleTmp,
  compareHermesBytecode,
  enforceCacheLimits,
  extractBundleFromArchive,
  hermesBaseMeta,
  hermescArgsWithBase,
  normalizeDisassemblyLine,
  probeHbcVersion,
  resolveHermesBase,
  tmpDir,
  truncateHermesBaseDetail,
  verifyHermesBaseEquivalence,
} from '../src/utils/hermes-base';
import { locateZipEntry } from '../src/utils/zip-range';

// A real hermesc: `HERMESC=/path/to/hermesc bun test`, or one from the SDK
// repo's Example app next to this checkout; the compile-dependent tests are
// skipped otherwise.
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

function mkTemp(prefix: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function writeZip(zipPath: string, entries: Record<string, Buffer>) {
  const zip = new ZipFile();
  for (const [name, data] of Object.entries(entries)) {
    zip.addBuffer(data, name);
  }
  zip.end();
  await new Promise<void>((resolve, reject) => {
    zip.outputStream
      .pipe(fs.createWriteStream(zipPath))
      .on('close', () => resolve())
      .on('error', reject);
  });
}

function fakeHbc(version: number, payload = 'x'): Buffer {
  // magic (8) + version (4) + rest; enough for getHbcVersion
  const buf = Buffer.alloc(128 + payload.length);
  Buffer.from('c61fbc03c103191f', 'hex').copy(buf, 0);
  buf.writeUInt32LE(version, 8);
  buf.write(payload, 128);
  return buf;
}

describe('classifyHermesCommand', () => {
  let root: string;
  beforeEach(() => {
    root = mkTemp('rnu-hermes-gate-');
  });
  afterEach(() => {
    fs.removeSync(root);
  });

  test('classic hermesc locations are allowed', () => {
    expect(
      classifyHermesCommand(
        '/p/node_modules/react-native/sdks/hermesc/osx-bin/hermesc',
      ).allowed,
    ).toBe(true);
    expect(
      classifyHermesCommand('/p/node_modules/hermes-engine/osx-bin/hermesc')
        .allowed,
    ).toBe(true);
  });

  test('hermes-compiler builds are gated by version', () => {
    const cases: [string, boolean][] = [
      ['250829098.0.16', true],
      ['260318099.0.1', true],
      ['250601097.0.0', false],
      ['0.14.0-commitly-202509161340-d0d04cfaa', true],
      ['0.13.0-commitly-202507011340-abcdef123', false],
      ['0.17.0', true],
      ['0.12.0', false],
      ['weird', false],
    ];
    for (const [version, allowed] of cases) {
      const pkg = path.join(root, version, 'node_modules', 'hermes-compiler');
      fs.ensureDirSync(path.join(pkg, 'hermesc', 'osx-bin'));
      fs.writeJsonSync(path.join(pkg, 'package.json'), {
        name: 'hermes-compiler',
        version,
      });
      const result = classifyHermesCommand(
        path.join(pkg, 'hermesc', 'osx-bin', 'hermesc'),
      );
      expect([version, result.allowed]).toEqual([version, allowed]);
      expect(result.kind).toBe('hermes-compiler');
    }
  });

  test('unknown locations are refused', () => {
    expect(classifyHermesCommand('/usr/local/bin/hermesc').allowed).toBe(false);
  });
});

describe('bundle cache', () => {
  let dir: string;
  const previous = {
    cache: process.env.PAKTA_CACHE_DIR,
    max: process.env.PAKTA_CACHE_MAX_MB,
  };
  beforeEach(() => {
    dir = mkTemp('rnu-hermes-cache-');
    process.env.PAKTA_CACHE_DIR = dir;
    delete process.env.PAKTA_CACHE_MAX_MB;
  });
  afterEach(() => {
    if (previous.cache === undefined) delete process.env.PAKTA_CACHE_DIR;
    else process.env.PAKTA_CACHE_DIR = previous.cache;
    if (previous.max === undefined) delete process.env.PAKTA_CACHE_MAX_MB;
    else process.env.PAKTA_CACHE_MAX_MB = previous.max;
    fs.removeSync(dir);
  });

  test('put/lookup round-trips by sha256 and rejects corrupted content', async () => {
    expect(cacheDir()).toBe(dir);
    const bundle = Buffer.from('hello bundle');
    const { path: file, bundleHash } = await cachePut(bundle);
    expect(bundleHash).toBe(sha256Hex(bundle));
    expect(path.basename(file)).toBe(bundleHash);
    expect(await cacheLookup(bundleHash)).toBe(file);
    fs.writeFileSync(file, 'corrupted');
    expect(await cacheLookup(bundleHash)).toBeNull();
    expect(fs.existsSync(file)).toBe(false);
    expect(await cacheLookup('not-a-hash')).toBeNull();
  });

  test('evicts least recently used entries beyond the size limit', async () => {
    const a = await cachePut(Buffer.alloc(600 * 1024, 1), 1); // 1 MB limit
    await new Promise((r) => setTimeout(r, 20));
    const b = await cachePut(Buffer.alloc(600 * 1024, 2), 1);
    expect(fs.existsSync(b.path)).toBe(true);
    expect(fs.existsSync(a.path)).toBe(false);
    const stats = await cacheStats();
    expect(stats.files).toBe(1);
    await enforceCacheLimits(1);
    expect(await cleanCache()).toBe(1);
    expect((await cacheStats()).files).toBe(0);
  });

  test('cleanStaleTmp removes only old leftovers', async () => {
    const tmp = tmpDir();
    fs.ensureDirSync(tmp);
    const old = path.join(tmp, 'old.ppk');
    const fresh = path.join(tmp, 'fresh.ppk');
    fs.writeFileSync(old, 'x');
    fs.writeFileSync(fresh, 'y');
    const past = new Date(Date.now() - 2 * 24 * 3600 * 1000);
    fs.utimesSync(old, past, past);
    await cleanStaleTmp();
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
    fs.removeSync(tmp);
  });
});

describe('extractBundleFromArchive', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkTemp('rnu-hermes-extract-');
  });
  afterEach(() => {
    fs.removeSync(dir);
  });

  test('reads the bundle entry of a ppk and an apk', async () => {
    const bundle = fakeHbc(98, 'ppk');
    const ppk = path.join(dir, 'a.ppk');
    await writeZip(ppk, {
      'index.bundlejs': bundle,
      '__diff.json': Buffer.from('{}'),
    });
    expect((await extractBundleFromArchive(ppk))?.equals(bundle)).toBe(true);

    const apk = path.join(dir, 'a.apk');
    await writeZip(apk, {
      'assets/index.android.bundle': bundle,
      'AndroidManifest.xml': Buffer.from(''),
    });
    expect((await extractBundleFromArchive(apk))?.equals(bundle)).toBe(true);

    const raw = path.join(dir, 'a.hbc');
    fs.writeFileSync(raw, bundle);
    expect((await extractBundleFromArchive(raw))?.equals(bundle)).toBe(true);
  });

  test('returns null when no bundle entry exists', async () => {
    const ppk = path.join(dir, 'empty.ppk');
    await writeZip(ppk, { 'other.txt': Buffer.from('x') });
    expect(await extractBundleFromArchive(ppk)).toBeNull();
  });
});

describe('resolveHermesBase', () => {
  let dir: string;
  const previousCache = process.env.PAKTA_CACHE_DIR;
  const logs: string[] = [];
  beforeEach(() => {
    dir = mkTemp('rnu-hermes-resolve-');
    process.env.PAKTA_CACHE_DIR = path.join(dir, 'cache');
    logs.length = 0;
  });
  afterEach(() => {
    if (previousCache === undefined) delete process.env.PAKTA_CACHE_DIR;
    else process.env.PAKTA_CACHE_DIR = previousCache;
    fs.removeSync(dir);
  });
  const common = {
    hermesCommand: 'hermesc',
    bytecodeVersion: 98,
    log: (m: string) => logs.push(m),
  };

  test("'none' and missing app skip the base", async () => {
    expect(
      await resolveHermesBase({
        ...common,
        option: 'none',
        fetchBase: async () => null,
      }),
    ).toBeNull();
    expect(
      await resolveHermesBase({
        ...common,
        option: 'auto',
        fetchBase: async () => null,
      }),
    ).toBeNull();
    expect(logs.length).toBe(2);
  });

  test('explicit local ppk is used when its HBC version matches', async () => {
    const ppk = path.join(dir, 'base.ppk');
    const bundle = fakeHbc(98, 'local');
    await writeZip(ppk, { 'index.bundlejs': bundle });
    const selected = await resolveHermesBase({
      ...common,
      option: ppk,
      fetchBase: async () => null,
    });
    expect(selected?.source).toBe('local');
    expect(selected?.bundleHash).toBe(sha256Hex(bundle));
    expect(fs.readFileSync(selected!.path).equals(bundle)).toBe(true);
    // wrong version → refused
    const ppk96 = path.join(dir, 'base96.ppk');
    await writeZip(ppk96, { 'index.bundlejs': fakeHbc(96) });
    expect(
      await resolveHermesBase({
        ...common,
        option: ppk96,
        fetchBase: async () => null,
      }),
    ).toBeNull();
  });

  test('server record: cache hit, then download + verify + cache, mismatching hash refused', async () => {
    const bundle = fakeHbc(98, 'server');
    const bundleHash = sha256Hex(bundle);
    const ppk = path.join(dir, 'server.ppk');
    await writeZip(ppk, { 'main.jsbundle': bundle });
    const nativeBundle = fakeHbc(98, 'native');
    const apk = path.join(dir, 'native.apk');
    await writeZip(apk, { 'assets/index.android.bundle': nativeBundle });
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        if (new URL(req.url).pathname === '/good.ppk')
          return new Response(Bun.file(ppk));
        if (new URL(req.url).pathname === '/native.apk')
          return new Response(Bun.file(apk));
        return new Response('nope', { status: 404 });
      },
    });
    try {
      const record = {
        versionId: 7,
        hash: 'objkey123',
        bundleHash,
        bytecodeVersion: 98,
        url: `http://127.0.0.1:${server.port}/good.ppk`,
      };
      const first = await resolveHermesBase({
        ...common,
        option: 'auto',
        appId: '1',
        fetchBase: async () => record,
      });
      expect(first?.source).toBe('download');
      expect(first?.versionId).toBe(7);
      expect(first?.bundleHash).toBe(bundleHash);
      const second = await resolveHermesBase({
        ...common,
        option: 'auto',
        appId: '1',
        fetchBase: async () => record,
      });
      expect(second?.source).toBe('cache');
      // hash mismatch → no base
      const bad = { ...record, bundleHash: 'f'.repeat(64) };
      await cleanCache();
      expect(
        await resolveHermesBase({
          ...common,
          option: 'auto',
          appId: '1',
          fetchBase: async () => bad,
        }),
      ).toBeNull();
      // epoch unknown (bytecodeVersion null) → verified after download
      const legacy = { ...record, bundleHash: null, bytecodeVersion: null };
      const fromLatest = await resolveHermesBase({
        ...common,
        option: 'auto',
        appId: '1',
        fetchBase: async () => legacy,
      });
      expect(fromLatest?.source).toBe('latest-version');
      await cleanCache();
      const fromNativePackage = await resolveHermesBase({
        ...common,
        option: 'auto',
        appId: '1',
        fetchBase: async () => ({
          versionId: null,
          hash: 'nativekey',
          artifactType: 'apk',
          bundleHash: sha256Hex(nativeBundle),
          bytecodeVersion: null,
          url: `http://127.0.0.1:${server.port}/native.apk`,
        }),
      });
      expect(fromNativePackage?.source).toBe('native-package');
      expect(fromNativePackage?.versionId).toBeUndefined();
      expect(fromNativePackage?.hash).toBe('nativekey');
      expect(
        fs.readFileSync(fromNativePackage!.path).equals(nativeBundle),
      ).toBe(true);
      // server has a different epoch → no base
      expect(
        await resolveHermesBase({
          ...common,
          option: 'auto',
          appId: '1',
          fetchBase: async () => ({ ...record, bytecodeVersion: 96 }),
        }),
      ).toBeNull();
      // download failure → no base (cache emptied first, a hit would short-circuit)
      await cleanCache();
      expect(
        await resolveHermesBase({
          ...common,
          option: 'auto',
          appId: '1',
          fetchBase: async () => ({
            ...record,
            url: `http://127.0.0.1:${server.port}/missing.ppk`,
          }),
        }),
      ).toBeNull();
    } finally {
      server.stop(true);
    }
  });
});

describe('resolveHermesBase over HTTP Range', () => {
  test('a located ppk bundle is fetched with one Range request', async () => {
    const dir = mkTemp('rnu-hermes-range-');
    process.env.PAKTA_CACHE_DIR = path.join(dir, 'cache');
    const bundle = fakeHbc(98, 'ranged');
    const ppk = path.join(dir, 'server.ppk');
    await writeZip(ppk, {
      'assets/a.bin': Buffer.alloc(200 * 1024, 1),
      'index.bundlejs': bundle,
    });
    const file = fs.readFileSync(ppk);
    const requests: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const range = req.headers.get('range') ?? 'full';
        requests.push(range);
        const match = /^bytes=(\d+)-(\d+)$/.exec(range);
        if (!match) return new Response(file);
        const [start, end] = [Number(match[1]), Number(match[2])];
        return new Response(file.subarray(start, end + 1), {
          status: 206,
          headers: { 'Content-Range': `bytes ${start}-${end}/${file.length}` },
        });
      },
    });
    const messages: string[] = [];
    try {
      const location = (await locateZipEntry(
        ppk,
        (n) => n === 'index.bundlejs',
      ))!;
      const selection = await resolveHermesBase({
        option: 'auto',
        hermesCommand:
          '/x/node_modules/react-native/sdks/hermesc/osx-bin/hermesc',
        bytecodeVersion: 98,
        appId: '1',
        log: (m) => messages.push(m),
        fetchBase: async () => ({
          versionId: 9,
          hash: 'objkey',
          bundleHash: sha256Hex(bundle),
          bytecodeVersion: 98,
          url: `http://127.0.0.1:${server.port}/server.ppk`,
          bundleOffset: location.dataOffset,
          bundleCompressedSize: location.compressedSize,
          bundleCompression: location.compressionMethod,
        }),
      });
      expect(selection?.source).toBe('download');
      expect(selection?.versionId).toBe(9);
      expect(fs.readFileSync(selection!.path).equals(bundle)).toBe(true);
      expect(requests).toEqual([
        `bytes=${location.dataOffset}-${location.dataOffset + location.compressedSize - 1}`,
      ]);
      expect(messages.some((m) => m.includes('HTTP Range'))).toBe(true);
    } finally {
      server.stop(true);
      delete process.env.PAKTA_CACHE_DIR;
      fs.removeSync(dir);
    }
  });

  test('a bundleHash mismatch of the real entry is final: no full download, no retry', async () => {
    const dir = mkTemp('rnu-hermes-mismatch-');
    process.env.PAKTA_CACHE_DIR = path.join(dir, 'cache');
    const ppk = path.join(dir, 'server.ppk');
    await writeZip(ppk, {
      'assets/a.bin': Buffer.alloc(200 * 1024, 1),
      'index.bundlejs': fakeHbc(98, 'replaced'),
    });
    const file = fs.readFileSync(ppk);
    const requests: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const range = req.headers.get('range') ?? 'full';
        requests.push(range);
        const match = /^bytes=(?:(\d+)-(\d+)|-(\d+))$/.exec(range);
        if (!match) return new Response(file);
        const [start, end] = match[3]
          ? [Math.max(0, file.length - Number(match[3])), file.length - 1]
          : [Number(match[1]), Number(match[2])];
        return new Response(file.subarray(start, end + 1), {
          status: 206,
          headers: { 'Content-Range': `bytes ${start}-${end}/${file.length}` },
        });
      },
    });
    const messages: string[] = [];
    try {
      const selection = await resolveHermesBase({
        option: 'auto',
        hermesCommand:
          '/x/node_modules/react-native/sdks/hermesc/osx-bin/hermesc',
        bytecodeVersion: 98,
        appId: '1',
        log: (m) => messages.push(m),
        fetchBase: async () => ({
          versionId: 9,
          hash: 'objkey',
          bundleHash: 'f'.repeat(64),
          bytecodeVersion: 98,
          url: `http://127.0.0.1:${server.port}/server.ppk`,
        }),
      });
      expect(selection).toBeNull();
      expect(requests).not.toContain('full');
      // one pass over the directory transport, then it stops
      expect(requests.length).toBeLessThanOrEqual(3);
      expect(messages.at(-1)).toContain('bundleHash mismatch');
    } finally {
      server.stop(true);
      delete process.env.PAKTA_CACHE_DIR;
      fs.removeSync(dir);
    }
  });

  test('a cache hit for a record of unknown HBC version is checked by header', async () => {
    const dir = mkTemp('rnu-hermes-cachehit-');
    process.env.PAKTA_CACHE_DIR = path.join(dir, 'cache');
    try {
      const stale = fakeHbc(96, 'native');
      const { bundleHash } = await cachePut(stale);
      const messages: string[] = [];
      const record = {
        versionId: null,
        hash: 'nativekey',
        artifactType: 'apk' as const,
        bundleHash,
        bytecodeVersion: null,
        url: 'http://127.0.0.1:9/unreachable.apk',
      };
      const params = {
        option: 'auto',
        hermesCommand:
          '/x/node_modules/react-native/sdks/hermesc/osx-bin/hermesc',
        appId: '1',
        log: (m: string) => messages.push(m),
        fetchBase: async () => record,
      };
      expect(await resolveHermesBase({ ...params, bytecodeVersion: 98 })).toBe(
        null,
      );
      expect(messages.at(-1)).toContain('cached base is HBC 96, need 98');
      // the right version is served from the cache as before
      const hit = await resolveHermesBase({ ...params, bytecodeVersion: 96 });
      expect(hit?.source).toBe('cache');
    } finally {
      delete process.env.PAKTA_CACHE_DIR;
      fs.removeSync(dir);
    }
  });
});

describe('cache staging leftovers', () => {
  test('old <hash>.<pid>.tmp files are evicted, fresh ones kept, clean removes all', async () => {
    const dir = mkTemp('rnu-hermes-tmp-');
    process.env.PAKTA_CACHE_DIR = dir;
    try {
      const hash = 'a'.repeat(64);
      const old = path.join(dir, `${hash}.111.tmp`);
      const fresh = path.join(dir, `${hash}.222.tmp`);
      fs.writeFileSync(old, 'x');
      fs.writeFileSync(fresh, 'y');
      const past = new Date(Date.now() - 2 * 3600 * 1000);
      fs.utimesSync(old, past, past);
      await enforceCacheLimits();
      expect(fs.existsSync(old)).toBe(false);
      expect(fs.existsSync(fresh)).toBe(true);
      expect((await cacheStats()).files).toBe(0);
      expect(await cleanCache()).toBe(0);
      expect(fs.existsSync(fresh)).toBe(false);
    } finally {
      delete process.env.PAKTA_CACHE_DIR;
      fs.removeSync(dir);
    }
  });
});

describe('helpers', () => {
  test('hermescArgsWithBase appends the base flag', () => {
    expect(hermescArgsWithBase(['-emit-binary'], '/b.hbc')).toEqual([
      '-emit-binary',
      '-base-bytecode=/b.hbc',
    ]);
    expect(hermescArgsWithBase(['-emit-binary'], null)).toEqual([
      '-emit-binary',
    ]);
  });

  test('hermesBaseMeta reports the chain fields', () => {
    expect(hermesBaseMeta(null, 98)).toEqual({
      bytecodeVersion: 98,
      baseVersionId: null,
      baseHash: null,
    });
    expect(
      hermesBaseMeta(
        {
          path: 'x',
          bytecodeVersion: 98,
          bundleHash: 'h',
          versionId: 3,
          hash: 'k',
          source: 'cache',
        },
        98,
      ),
    ).toEqual({ bytecodeVersion: 98, baseVersionId: 3, baseHash: 'k' });
  });

  test('hermesBaseMeta carries the check outcome without ever writing null', () => {
    // base dropped: the chain fields say "no base", the outcome says why
    const rejected = hermesBaseMeta(null, 98, {
      outcome: 'rejected',
      detail: 'Function<f>  line 3:\n  a\n  b',
    });
    expect(rejected.hermesBaseDetail).toMatch(
      /^Function<fn#[0-9a-f]{8}> line 3: a b$/,
    );
    expect(rejected.hermesBaseFingerprint).toMatch(/^[0-9a-f]{32}$/);
    // the function name is redacted on the way out; the shape is not
    expect({
      ...rejected,
      hermesBaseDetail: '',
      hermesBaseFingerprint: '',
    }).toEqual({
      bytecodeVersion: 98,
      baseVersionId: null,
      baseHash: null,
      hermesBaseOutcome: 'rejected',
      hermesBaseDetail: '',
      hermesBaseFingerprint: '',
    });
    // no detail → no key (the server rejects JSON null, and '' is noise)
    expect(hermesBaseMeta(null, 98, { outcome: 'none' })).toEqual({
      bytecodeVersion: 98,
      baseVersionId: null,
      baseHash: null,
      hermesBaseOutcome: 'none',
    });
    expect(hermesBaseMeta(null, 98, { outcome: 'used', detail: '  ' })).toEqual(
      {
        bytecodeVersion: 98,
        baseVersionId: null,
        baseHash: null,
        hermesBaseOutcome: 'used',
      },
    );
    // no check at all (hermesc never ran): the keys are absent
    expect('hermesBaseOutcome' in hermesBaseMeta(null, null)).toBe(false);
  });

  test('truncateHermesBaseDetail caps by code point, not by UTF-16 unit', () => {
    expect(truncateHermesBaseDetail(undefined)).toBe('');
    expect(truncateHermesBaseDetail('a'.repeat(500))).toHaveLength(500);
    expect(truncateHermesBaseDetail('a'.repeat(501))).toHaveLength(500);
    const astral = '😀'.repeat(600);
    const cut = truncateHermesBaseDetail(astral);
    expect(Array.from(cut)).toHaveLength(500);
    expect(cut).toBe('😀'.repeat(500));
  });

  test('normalizeDisassemblyLine hides representation-only differences', () => {
    const strings = new Map([[11591, 'foo']]);
    expect(
      normalizeDisassemblyLine('    NewArrayWithBuffer r5, 1, 1, 632', strings),
    ).toBe('    NewArrayWithBuffer r5 sizes=1');
    expect(
      normalizeDisassemblyLine(
        '    NewObjectWithBufferLong r5, 386, 9000',
        strings,
      ),
    ).toBe('    NewObjectWithBuffer r5 sizes=386');
    expect(
      normalizeDisassemblyLine('    JStrictEqualLong L12, r1, r2', strings),
    ).toBe('    JStrictEqual L12, r1, r2');
    // hermesc prints the string id for DefineOwnById and the (display
    // truncated) text for DefineOwnByIdLong, which a base compile picks as
    // soon as the inherited string table pushes the id past 16 bits. Both
    // renderings fold to one operand; the raw audit compares the name itself.
    expect(
      normalizeDisassemblyLine('    DefineOwnById r7, r8, 2, 11591', strings),
    ).toBe('    DefineOwnById r7, r8, 2, <str>');
    expect(
      normalizeDisassemblyLine(
        '    DefineOwnByIdLong r7, r8, 2, "equivalenceCheckP"...',
        strings,
      ),
    ).toBe('    DefineOwnById r7, r8, 2, <str>');
    expect(() =>
      normalizeDisassemblyLine('    DefineOwnById r7, r8, 2, 4242', strings),
    ).toThrow('unresolved string id 4242');
    expect(
      normalizeDisassemblyLine('Offset in debug table: source 0x0000', strings),
    ).toBeNull();
    // operand-width variants and padding fold together (foreign base → wide ids)
    expect(
      normalizeDisassemblyLine(
        '    GetByIdShort      r1, r1, 4, "process"',
        strings,
      ),
    ).toBe(
      normalizeDisassemblyLine(
        '    GetById           r1, r1, 4, "process"',
        strings,
      ),
    );
    expect(
      normalizeDisassemblyLine('    LoadConstStringLongIndex r0, "x"', strings),
    ).toBe('    LoadConstString r0, "x"');
    expect(
      normalizeDisassemblyLine(
        '    StringSwitchImm   r13, 2, 4024, L146, 150',
        strings,
      ),
    ).toBe('    StringSwitchImm r13, 2, <jt>, L146, 150');
    // UIntSwitchImm carries the jump-table offset one operand earlier
    expect(
      normalizeDisassemblyLine(
        '    UIntSwitchImm     r40, 5937, L3, 0, 31',
        strings,
      ),
    ).toBe('    UIntSwitchImm r40, <jt>, L3, 0, 31');
    expect(
      normalizeDisassemblyLine(
        '    UIntSwitchImm     r40, 5938, L3, 0, 31',
        strings,
      ),
    ).toBe('    UIntSwitchImm r40, <jt>, L3, 0, 31');
    expect(normalizeDisassemblyLine('  offset 4024', strings)).toBe(
      '  offset <jt>',
    );
    expect(
      normalizeDisassemblyLine('    GetByIdShort r3, r0, 2, "s"', strings),
    ).toBe('    GetById r3, r0, 2, "s"');
  });
});

describe.if(hasHermesc)('with a real hermesc', () => {
  let dir: string;
  const previousCache = process.env.PAKTA_CACHE_DIR;
  beforeEach(() => {
    dir = mkTemp('rnu-hermes-real-');
    process.env.PAKTA_CACHE_DIR = path.join(dir, 'cache');
  });
  afterEach(() => {
    if (previousCache === undefined) delete process.env.PAKTA_CACHE_DIR;
    else process.env.PAKTA_CACHE_DIR = previousCache;
    fs.removeSync(dir);
  });

  test('probeHbcVersion returns the bytecode version', () => {
    const version = probeHbcVersion(hermesc!);
    expect(version).toBeGreaterThanOrEqual(90);
  });

  test('base compile is disassembly-equivalent to a plain compile; a different program is not', async () => {
    const base = path.join(dir, 'base.js');
    const next = path.join(dir, 'next.js');
    const other = path.join(dir, 'other.js');
    fs.writeFileSync(
      base,
      "var s = 'foo'; print(s, 'bar', 'baz'); var t = 'qux';\n",
    );
    fs.writeFileSync(
      next,
      `${fs.readFileSync(base, 'utf8')}var o = {}; o.foo = 1; o.bar = 2; print(o.foo, o.bar, o.qux, [1, 'new1', 'new2']);\n`,
    );
    fs.writeFileSync(other, "print('completely different');\n");
    const compile = (input: string, out: string, extra: string[] = []) =>
      spawnSync(
        hermesc!,
        ['-emit-binary', '-out', out, input, '-O', '-w', ...extra],
        { stdio: 'ignore' },
      ).status;
    const baseHbc = path.join(dir, 'base.hbc');
    const plainHbc = path.join(dir, 'next.plain.hbc');
    const deltaHbc = path.join(dir, 'next.delta.hbc');
    const otherHbc = path.join(dir, 'other.hbc');
    expect(compile(base, baseHbc)).toBe(0);
    expect(compile(next, plainHbc)).toBe(0);
    expect(compile(next, deltaHbc, [`-base-bytecode=${baseHbc}`])).toBe(0);
    expect(compile(other, otherHbc)).toBe(0);
    expect(
      await verifyHermesBaseEquivalence(hermesc!, deltaHbc, plainHbc),
    ).toBe(true);
    expect(
      await verifyHermesBaseEquivalence(hermesc!, otherHbc, plainHbc),
    ).toBe(false);
    // the bundle inside a ppk has no .hbc extension; hermesc must still read
    // it as bytecode (-b)
    const noExt = path.join(dir, 'index.bundlejs');
    fs.copyFileSync(deltaHbc, noExt);
    expect(await verifyHermesBaseEquivalence(hermesc!, noExt, plainHbc)).toBe(
      true,
    );
  });
});

describe('publish metadata never sends JSON null', () => {
  test('describePpkBundle omits unknown chain fields', async () => {
    const { describePpkBundleForTests } = await import('../src/versions');
    const dir = mkTemp('rnu-publish-meta-');
    try {
      const ppk = path.join(dir, 'v.ppk');
      await writeZip(ppk, { 'index.bundlejs': fakeHbc(98, 'meta') });
      const noBase = await describePpkBundleForTests(ppk, undefined);
      expect(noBase.bundleHash).toBe(sha256Hex(fakeHbc(98, 'meta')));
      expect(noBase.bytecodeVersion).toBe(98);
      // bundle location inside the ppk for single-Range base downloads
      const location = await locateZipEntry(ppk, (n) => n === 'index.bundlejs');
      expect(noBase.bundleOffset).toBe(location!.dataOffset);
      expect(noBase.bundleCompressedSize).toBe(location!.compressedSize);
      expect(noBase.bundleCompression).toBe(location!.compressionMethod);
      expect('baseVersionId' in noBase).toBe(false);
      expect('baseHash' in noBase).toBe(false);
      expect(Object.values(noBase).some((v) => v === null)).toBe(false);
      const withBase = await describePpkBundleForTests(ppk, {
        bytecodeVersion: 98,
        baseVersionId: 7,
        baseHash: 'objkey',
      });
      expect(withBase.baseVersionId).toBe(7);
      expect(withBase.baseHash).toBe('objkey');
      expect('hermesBaseOutcome' in withBase).toBe(false);
      expect('hermesBaseDetail' in withBase).toBe(false);
      // the check result rides along only when known, detail only when non-empty
      const rejected = await describePpkBundleForTests(ppk, {
        bytecodeVersion: 98,
        baseVersionId: null,
        baseHash: null,
        hermesBaseOutcome: 'rejected',
        hermesBaseDetail: `Function<f> line 3: ${'x'.repeat(600)}`,
      });
      expect(rejected.hermesBaseOutcome).toBe('rejected');
      expect(Array.from(rejected.hermesBaseDetail as string)).toHaveLength(500);
      expect('baseVersionId' in rejected).toBe(false);
      expect(Object.values(rejected).some((v) => v === null)).toBe(false);
      const used = await describePpkBundleForTests(ppk, {
        bytecodeVersion: 98,
        baseVersionId: 7,
        baseHash: 'objkey',
        hermesBaseOutcome: 'used',
      });
      expect(used.hermesBaseOutcome).toBe('used');
      expect('hermesBaseDetail' in used).toBe(false);
      // 纯 JS bundle：上报 0（plain JS），绝不发送 null
      const js = path.join(dir, 'js.ppk');
      await writeZip(js, { 'index.bundlejs': Buffer.from('var a = 1;') });
      const plain = await describePpkBundleForTests(js, undefined);
      expect(plain.bytecodeVersion).toBe(0);
    } finally {
      fs.removeSync(dir);
    }
  });
});

/** the regex-per-line implementation the fast path replaced; must agree */
function legacyNormalize(line: string): string | null {
  if (/^Offset in debug table/.test(line)) return null;
  let m =
    /^(\s*New(?:Array|Object)WithBuffer)(?:Long)?(AndParent)?\s+(r\d+)(?:, (r\d+))?(.*)$/.exec(
      line,
    );
  if (m) {
    const nums = m[5].match(/\d+/g) ?? [];
    const regs = m[4] ? `${m[3]} ${m[4]}` : m[3];
    return `${m[1]}${m[2] ?? ''} ${regs} sizes=${nums.slice(0, 1).join(',')}`;
  }
  m = /^(\s*J[A-Za-z]+?)(Long)?\s+(L\d+|\d+)(.*)$/.exec(line);
  if (m) return `${m[1]} ${m[3]}${m[4]}`;
  m = /^(\s*DefineOwnById\w*\s+r\d+, r\d+, \d+, )(\d+)?.*$/.exec(line);
  if (m) line = `${m[1]}<str>`;
  m = /^(\s*)([A-Za-z]+?)(?:LongIndex|Long|Short)?(\s+.*|)$/.exec(line);
  if (m) line = `${m[1]}${m[2]}${m[3].replace(/\s+/g, ' ')}`;
  m = /^(\s*StringSwitchImm r\d+, \d+, )\d+(, L\d+, \d+)$/.exec(line);
  if (m) line = `${m[1]}<jt>${m[2]}`;
  m = /^(\s*UIntSwitchImm r\d+, )\d+(, L\d+, \d+, \d+)$/.exec(line);
  if (m) line = `${m[1]}<jt>${m[2]}`;
  if (/^\s*offset \d+$/.test(line)) line = line.replace(/\d+$/, '<jt>');
  return line;
}

describe('normalizeDisassemblyLine fast path', () => {
  test('agrees with the regex-only implementation on representative lines', () => {
    const strings = new Map([
      [3, 'foo'],
      [42, 'bar'],
      [7, 'known'],
    ]);
    const corpus = [
      'Offset in debug table: source 0x0, lexical 0x0',
      '    NewArrayWithBuffer r1, 3, 3, 12',
      '    NewArrayWithBufferLong r1, 300, 300, 65540',
      '    NewObjectWithBuffer r2, 2, 2, 0, 0',
      '    NewObjectWithBufferLong r2, 2, 2, 70000, 70000',
      '    NewObjectWithBufferAndParent r2, r3, 0, 0',
      '    NewObjectWithBuffer r2, 1, 19',
      '    Jmp L5',
      '    JmpLong L5',
      '    JNotEqual L3, r1, r2',
      '    JmpTrue 12, r4',
      '    JStrictEqualLong L9, r0, r1',
      '    DefineOwnById r0, r1, 1, 3',
      '    DefineOwnByIdLong r0, r1, 1, 42',
      '    DefineOwnByIdShort r0, r1, 1, 7',
      '    DefineOwnByIdLong r0, r1, 1, "a-name-past-the-p"...',
      '    GetByIdShort   r1, r0, 1, "foo"',
      '    GetById        r1, r0, 1, "foo"',
      '    GetByIdLong    r1, r0, 1, "foo"',
      '    LoadConstString r3, "x"',
      '    LoadConstStringLongIndex r3, "x"',
      '    Mov     r1,\tr2',
      '    Ret r0',
      '    Long r1',
      '    Short',
      '    LongLong r2',
      '    ShortLong r2',
      '    XLongIndexLong r2',
      '    StringSwitchImm r1, 5, 120, L2, 3',
      '    StringSwitchImm r1, 5, 120, L2, 3, 9',
      '    UIntSwitchImm r1, 96, L4, 0, 5',
      '    UIntSwitchImm r1, 96, L4, 0, 5, 1',
      '  offset 96',
      '    offset 12 ',
      'offset abc',
      'Function<global>(1 params, 12 registers, 0 symbols):',
      'Function<foo>(2 params, 3 registers):',
      'L1:',
      '  L2:',
      '',
      '   ',
      '\tRet\tr0',
      'Exception Handlers:',
      '  0: start = L1, end = L2, target = L3',
      '    ; comment-like',
      'i5[ASCII, 0..2]: foo',
      's0[UTF-16, 3..5] #ABCD: bar',
      'CJSModuleTable:',
      '    Debugger',
      '    Debugger ',
      '    CreateClosureLongIndex r1, r0, Function<bar>',
      '    Call r1, r2, 3',
      '    NewArray r1, 0',
      '    Newarrays r1',
      '    New r1',
      '    JmpUndefined',
      '    J',
      'Jmp L1',
      'NewArrayWithBuffer r1, 3, 3, 12',
    ];
    for (const line of corpus) {
      expect(normalizeDisassemblyLine(line, strings)).toBe(
        legacyNormalize(line),
      );
    }
  });
});

describe('probeHbcVersion cache', () => {
  let dir: string;
  const previous = process.env.PAKTA_CACHE_DIR;
  beforeEach(() => {
    dir = mkTemp('rnu-hermes-probe-cache-');
    process.env.PAKTA_CACHE_DIR = path.join(dir, 'cache');
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.PAKTA_CACHE_DIR;
    else process.env.PAKTA_CACHE_DIR = previous;
    fs.removeSync(dir);
  });

  test.if(os.platform() !== 'win32')(
    'compiles once per hermesc binary and again when the binary changes',
    () => {
      const fixture = path.join(dir, 'probe.hbc');
      fs.writeFileSync(fixture, fakeHbc(96));
      const calls = path.join(dir, 'calls.log');
      const script = path.join(dir, 'hermesc');
      const write = (marker: string) =>
        fs.writeFileSync(
          script,
          `#!/bin/sh\n# ${marker}\necho run >> "${calls}"\nwhile [ $# -gt 0 ]; do if [ "$1" = "-out" ]; then cp "${fixture}" "$2"; shift; fi; shift; done\n`,
          { mode: 0o755 },
        );
      write('v1');
      expect(probeHbcVersion(script)).toBe(96);
      expect(probeHbcVersion(script)).toBe(96);
      expect(fs.readFileSync(calls, 'utf8').trim().split('\n')).toHaveLength(1);
      expect(fs.existsSync(path.join(cacheDir(), 'hbc-versions.json'))).toBe(
        true,
      );
      // a different binary (size changes) is probed again
      write('v2-longer');
      expect(probeHbcVersion(script)).toBe(96);
      expect(fs.readFileSync(calls, 'utf8').trim().split('\n')).toHaveLength(2);
      // the sha256-named bundle cache ignores the probe file
      expect(fs.readdirSync(cacheDir())).toEqual(['hbc-versions.json']);
    },
  );
});

// ---------------------------------------------------------------------------
// compareHermesBytecode over synthetic dumps: a fake hermesc that prints the
// "bytecode" file it is given, so every branch runs without a real compiler
// ---------------------------------------------------------------------------

const PLAIN_DUMP = `Bytecode File Information:
  Bytecode version number: 96
  Function count: 2

Global String Table:
i0[ASCII, 0..2] #AAAA: foo
s1[ASCII, 3..5] #BBBB: bar
i2[ASCII, 6..8]: baz

Array Buffer:
[int 1]
[String 1]
Object Key Buffer:
[String 0]
Object Value Buffer:
[String 2]
Function<global>(1 params, 3 registers, 0 symbols):
Offset in debug table: source 0x0000, lexical 0x0000
    LoadConstString   r0, "bar"
    NewArrayWithBuffer r1, 2, 2, 0
    GetByIdShort      r2, r1, 1, "foo"
    DefineOwnById     r1, r0, 1, 0
    Ret               r0

Function<f>(2 params, 2 registers, 0 symbols):
    LoadParam         r1, 1
    JmpTrue           L1, r1
L1:
    Ret               r1

Debug filename table:
  (none)

Debug source table:
  0x0000  end of debug source table
`;

// the same program compiled against a foreign base: dead base strings keep
// their ids, new strings get large ids, buffers and jumps move accordingly
const DELTA_DUMP = `Bytecode File Information:
  Bytecode version number: 96
  Function count: 2

Global String Table:
i0[ASCII, 0..3] #1111: dead
i1[ASCII, 4..7] #2222: old
s2[ASCII, 3..5] #BBBB: bar
i3[ASCII, 6..8]: baz
i4[ASCII, 0..2] #AAAA: foo

Array Buffer:
[int 1]
[String 2]
Object Key Buffer:
[String 4]
Object Value Buffer:
[String 3]
Function<global>(1 params, 3 registers, 0 symbols):
Offset in debug table: source 0x0040, lexical 0x0010
    LoadConstStringLongIndex r0, "bar"
    NewArrayWithBufferLong r1, 2, 2, 300
    GetById           r2, r1, 1, "foo"
    DefineOwnByIdLong r1, r0, 1, 4
    Ret               r0

Function<f>(2 params, 2 registers, 0 symbols):
    LoadParam         r1, 1
    JmpTrueLong       L1, r1
L1:
    Ret               r1

Debug filename table:
  0: other.js

Debug source table:
  0x0000  function idx 0, starts at line 1 col 1
  0x0010  end of debug source table
`;

describe.if(os.platform() !== 'win32')(
  'compareHermesBytecode (fake hermesc)',
  () => {
    let dir: string;
    let fakeHermesc: string;
    const write = (name: string, dump: string) => {
      const file = path.join(dir, name);
      fs.writeFileSync(file, dump);
      return file;
    };
    beforeEach(() => {
      dir = mkTemp('rnu-hermes-cmp-');
      // prints the file named by the last argument; fails for *fail* files
      fakeHermesc = path.join(dir, 'hermesc');
      fs.writeFileSync(
        fakeHermesc,
        '#!/bin/sh\nfor f; do :; done\ncase "$f" in *fail*) echo "boom: $f" >&2; exit 3;; esac\ncat "$f"\n',
      );
      fs.chmodSync(fakeHermesc, 0o755);
    });
    afterEach(() => fs.removeSync(dir));

    test('matching text dumps without readable HBC metadata are unverifiable', async () => {
      const result = await compareHermesBytecode(
        fakeHermesc,
        write('delta.hbc', DELTA_DUMP),
        write('plain.hbc', PLAIN_DUMP),
      );
      // Equal human-readable text cannot establish bytecode equivalence.
      expect(result).toEqual({
        status: 'dump-failed',
        detail:
          'unsupported or unreadable HBC layout; text-only comparison cannot verify equivalence',
        functions: 2,
        literals: 'buffer',
      });
      expect(
        await verifyHermesBaseEquivalence(
          fakeHermesc,
          write('d2.hbc', DELTA_DUMP),
          write('p2.hbc', PLAIN_DUMP),
        ),
      ).toBe(false);
    });

    test("literal buffer content is compared through each side's string table", async () => {
      // same shape, but the array literal holds a different string
      const wrong = DELTA_DUMP.replace(
        'Array Buffer:\n[int 1]\n[String 2]',
        'Array Buffer:\n[int 1]\n[String 3]',
      );
      const result = await compareHermesBytecode(
        fakeHermesc,
        write('delta.hbc', wrong),
        write('plain.hbc', PLAIN_DUMP),
      );
      expect(result.status).toBe('different');
      expect(result.detail).toBe(
        'Array Buffer entry 1: [String "baz"] vs [String "bar"]',
      );
      expect(result.functions).toBe(0);
    });

    test('a DefineOwnById property name is left to the raw audit, never to the text', async () => {
      // hermesc prints this operand as a string id in one build and as
      // display-truncated text in the other, so the pretty pass folds it
      // away. A name that differs is caught by the raw audit against the
      // binary string table; here the fake compiler has no readable HBC, so
      // the pass ends unverifiable -- the base is dropped either way and the
      // text alone never reports 'equivalent'.
      const wrong = DELTA_DUMP.replace(
        'DefineOwnByIdLong r1, r0, 1, 4',
        'DefineOwnByIdLong r1, r0, 1, 3',
      );
      const result = await compareHermesBytecode(
        fakeHermesc,
        write('delta.hbc', wrong),
        write('plain.hbc', PLAIN_DUMP),
      );
      expect(result.status).toBe('dump-failed');
      expect(result.detail).toBe(
        'unsupported or unreadable HBC layout; text-only comparison cannot verify equivalence',
      );
    });

    test('an extra instruction names the function and the line counts', async () => {
      const wrong = DELTA_DUMP.replace(
        'L1:\n    Ret               r1',
        'L1:\n    Mov               r0, r1\n    Ret               r1',
      );
      const result = await compareHermesBytecode(
        fakeHermesc,
        write('delta.hbc', wrong),
        write('plain.hbc', PLAIN_DUMP),
      );
      expect(result.status).toBe('different');
      expect(result.detail).toBe(
        'Function<f>(2 params, 2 registers, 0 symbols): +4: Mov r0, r1 vs Ret r1',
      );
      expect(result.functions).toBe(1);
    });

    test('a missing or extra function is reported as a count difference, not as a desync', async () => {
      const fewer = DELTA_DUMP.slice(0, DELTA_DUMP.indexOf('Function<f>'));
      const result = await compareHermesBytecode(
        fakeHermesc,
        write('delta.hbc', `${fewer}Debug filename table:\n  (none)\n`),
        write('plain.hbc', PLAIN_DUMP),
      );
      expect(result.status).toBe('different');
      expect(result.detail).toBe(
        'function count: Function<f>(2 params, 2 registers, 0 symbols): only in the plain compile',
      );
    });

    test("a dump that fails is dump-failed with the compiler's message, never a difference", async () => {
      const result = await compareHermesBytecode(
        fakeHermesc,
        write('delta-fail.hbc', DELTA_DUMP),
        write('plain.hbc', PLAIN_DUMP),
      );
      expect(result.status).toBe('dump-failed');
      expect(result.detail).toMatch(
        /^base dump: exit 3: boom: .*delta-fail\.hbc$/,
      );
      const plainSide = await compareHermesBytecode(
        fakeHermesc,
        write('delta.hbc', DELTA_DUMP),
        write('plain-fail.hbc', PLAIN_DUMP),
      );
      expect(plainSide.status).toBe('dump-failed');
      expect(plainSide.detail).toStartWith('plain dump: exit 3');
      // a compiler that cannot be started at all
      const missing = await compareHermesBytecode(
        path.join(dir, 'no-such-hermesc'),
        write('d.hbc', DELTA_DUMP),
        write('p.hbc', PLAIN_DUMP),
      );
      expect(missing.status).toBe('dump-failed');
      expect(missing.detail).toContain('ENOENT');
      // a dump that succeeds but lists no function is a real difference on
      // one side and nothing to compare on both
      const empty = await compareHermesBytecode(
        fakeHermesc,
        write('empty.hbc', 'Bytecode File Information:\n'),
        write('plain.hbc', PLAIN_DUMP),
      );
      expect(empty.status).toBe('different');
      expect(empty.detail).toBe(
        'function count: Function<global>(1 params, 3 registers, 0 symbols): only in the plain compile',
      );
      const bothEmpty = await compareHermesBytecode(
        fakeHermesc,
        write('e1.hbc', 'Bytecode File Information:\n'),
        write('e2.hbc', 'Bytecode File Information:\n'),
      );
      expect(bothEmpty).toEqual({
        status: 'dump-failed',
        detail: 'no functions in the disassembly',
        functions: 0,
        literals: 'buffer',
      });
    });

    test('dumpTo keeps both raw disassemblies for bug reports', async () => {
      const dumpTo = {
        withBase: path.join(dir, 'out', 'base.txt'),
        plain: path.join(dir, 'out', 'plain.txt'),
      };
      fs.ensureDirSync(path.dirname(dumpTo.withBase));
      const result = await compareHermesBytecode(
        fakeHermesc,
        write('delta.hbc', DELTA_DUMP),
        write('plain.hbc', PLAIN_DUMP),
        { dumpTo },
      );
      expect(result.status).toBe('dump-failed');
      // the tee streams close on their own once the processes exit
      await new Promise((r) => setTimeout(r, 100));
      expect(fs.readFileSync(dumpTo.withBase, 'utf8')).toBe(DELTA_DUMP);
      expect(fs.readFileSync(dumpTo.plain, 'utf8')).toBe(PLAIN_DUMP);
    });
  },
);

describe.if(hasHermesc)('compareHermesBytecode with a real hermesc', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkTemp('rnu-hermes-real-cmp-');
  });
  afterEach(() => fs.removeSync(dir));

  // enough identifiers and literals that the delta build has to use the
  // wide operand forms (Long/LongIndex) and re-lay the literal buffers
  const program = (prefix: string, count: number, tail: string) => {
    let src = 'var o = {};\n';
    for (let i = 0; i < count; i++) {
      src += `o.${prefix}${i} = ${i}; print(o.${prefix}${i}, "${prefix}s${i}");\n`;
    }
    src += `var arr = [${Array.from({ length: 40 }, (_, i) => `"${prefix}a${i}"`).join(', ')}, 1, 2.5, true, null];\n`;
    src += `var obj = {${Array.from({ length: 30 }, (_, i) => `k${i}: "${prefix}v${i}"`).join(', ')}};\n`;
    src +=
      'function f(x) { switch (x) { case 1: return "one"; case 2: return "two"; case 3: return "three"; default: return arr[x] || obj.k1; } }\n';
    src +=
      'function g(x) { switch (x) { case "a": return 1; case "b": return 2; case "c": return 3; default: return 0; } }\n';
    return `${src}print(f(1), g("a"), ${tail});\n`;
  };
  const compile = (input: string, out: string, extra: string[] = []) =>
    spawnSync(
      hermesc!,
      ['-emit-binary', '-out', out, input, '-O', '-w', ...extra],
      { stdio: 'ignore' },
    ).status;

  test('a large foreign base compiles equivalent; a one-literal change is caught with its location', async () => {
    const base = path.join(dir, 'base.js');
    const next = path.join(dir, 'next.js');
    const wrong = path.join(dir, 'wrong.js');
    fs.writeFileSync(base, program('a', 400, '"end"'));
    fs.writeFileSync(
      next,
      program('a', 150, '"end"') +
        program('b', 500, '"end2"')
          .replace(/\bo\b/g, 'o2')
          .replace(/\barr\b/g, 'arr2')
          .replace(/\bobj\b/g, 'obj2')
          .replace(/function ([fg])\(/g, 'function $12('),
    );
    // identical to next except one string inside an array literal
    fs.writeFileSync(
      wrong,
      fs.readFileSync(next, 'utf8').replace('"ba7"', '"ba7x"'),
    );
    const baseHbc = path.join(dir, 'base.hbc');
    const plainHbc = path.join(dir, 'next.plain.hbc');
    const deltaHbc = path.join(dir, 'next.delta.hbc');
    const wrongHbc = path.join(dir, 'wrong.hbc');
    expect(compile(base, baseHbc)).toBe(0);
    expect(compile(next, plainHbc)).toBe(0);
    expect(compile(next, deltaHbc, [`-base-bytecode=${baseHbc}`])).toBe(0);
    expect(compile(wrong, wrongHbc, [`-base-bytecode=${baseHbc}`])).toBe(0);
    // the delta build really did take the wide forms
    const dump = spawnSync(
      hermesc!,
      ['-b', '-dump-bytecode', '-pretty-disassemble', deltaHbc],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    ).stdout;
    expect(dump).toMatch(/GetById\s+r/);
    expect(dump).toMatch(/GetByIdShort\s+r/);

    const ok = await compareHermesBytecode(hermesc!, deltaHbc, plainHbc);
    expect(ok.status).toBe('equivalent');
    expect(ok.functions).toBeGreaterThanOrEqual(5);
    // real files: literals decoded at each instruction, not the dumped buffer
    expect(ok.literals).toBe('instruction');

    const bad = await compareHermesBytecode(hermesc!, wrongHbc, plainHbc);
    expect(bad.status).toBe('different');
    // the detail names the instruction and the entry, resolved to text
    expect(bad.detail).toMatch(
      /^Function<global>\(.*\): \+\d+: NewArrayWithBuffer r\d+ size=\d+ n=\d+ entry \d+: \[String "ba7x"\] vs \[String "ba7"\]$/,
    );
  });
});
