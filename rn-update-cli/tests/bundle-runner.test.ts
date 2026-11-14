import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  assertSafeToEmpty,
  buildHermescArgs,
  buildSentrySourcemapsUploadArgs,
  detectHermesEnabled,
  detectIosHermes,
  hasProjectDependency,
  prepareSentryUploadArtifacts,
  readSourcemapDebugId,
  resolveExpoCli,
  resolveHermesCommand,
  resolveSentryUploadMode,
  summarizeHermescStderr,
} from '../src/bundle-runner';

function mkTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function _writeFile(filePath: string, content = ''): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function hermesOSBin(): string {
  if (os.platform() === 'win32') return 'win64-bin';
  if (os.platform() === 'darwin') return 'osx-bin';
  return 'linux64-bin';
}

function hermesExecutableName(): string {
  return os.platform() === 'win32' ? 'hermesc.exe' : 'hermesc';
}

describe('hasProjectDependency', () => {
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = mkTempDir('rn-update-has-dep-');
  });

  afterEach(() => {
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('returns true when dependency is in dependencies', () => {
    writeJson(path.join(tempRoot, 'package.json'), {
      dependencies: { expo: '^54.0.0' },
    });
    expect(hasProjectDependency('expo', tempRoot)).toBe(true);
  });

  test('returns true when dependency is in devDependencies', () => {
    writeJson(path.join(tempRoot, 'package.json'), {
      devDependencies: { jest: '^30.0.0' },
    });
    expect(hasProjectDependency('jest', tempRoot)).toBe(true);
  });

  test('returns true when dependency is in peerDependencies', () => {
    writeJson(path.join(tempRoot, 'package.json'), {
      peerDependencies: { react: '>=18.0.0' },
    });
    expect(hasProjectDependency('react', tempRoot)).toBe(true);
  });

  test('returns true when dependency is in optionalDependencies', () => {
    writeJson(path.join(tempRoot, 'package.json'), {
      optionalDependencies: { fsevents: '^2.0.0' },
    });
    expect(hasProjectDependency('fsevents', tempRoot)).toBe(true);
  });

  test('returns false when dependency is not present anywhere', () => {
    writeJson(path.join(tempRoot, 'package.json'), {
      dependencies: { 'react-native': '0.82.0' },
    });
    expect(hasProjectDependency('expo', tempRoot)).toBe(false);
  });

  test('returns false when package.json does not exist', () => {
    expect(hasProjectDependency('expo', tempRoot)).toBe(false);
  });

  test('returns false when package.json has no dependency fields', () => {
    writeJson(path.join(tempRoot, 'package.json'), {
      name: 'test-app',
      version: '1.0.0',
    });
    expect(hasProjectDependency('expo', tempRoot)).toBe(false);
  });

  test('returns false when dependency field is null', () => {
    writeJson(path.join(tempRoot, 'package.json'), {
      dependencies: null,
      devDependencies: null,
    });
    expect(hasProjectDependency('expo', tempRoot)).toBe(false);
  });
});

describe('resolveExpoCli edge cases', () => {
  let originalCwd = '';
  let tempRoot = '';

  beforeEach(() => {
    originalCwd = process.cwd();
    tempRoot = mkTempDir('rn-update-expo-');
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('returns empty when no package.json exists', () => {
    const resolved = resolveExpoCli(tempRoot);
    expect(resolved).toEqual({ cliPath: '', usingExpo: false });
  });

  test('returns empty when expo is in deps but @expo/cli not installed', () => {
    writeJson(path.join(tempRoot, 'package.json'), {
      dependencies: { expo: '^54.0.0' },
    });
    // No @expo/cli in node_modules

    const resolved = resolveExpoCli(tempRoot);
    expect(resolved.usingExpo).toBe(false);
  });
});

describe('resolveHermesCommand', () => {
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = mkTempDir('rn-update-hermes-');
  });

  afterEach(() => {
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('resolves hermes-compiler path used by React Native 0.85', () => {
    const hermesCommand = path.join(
      tempRoot,
      'node_modules',
      'hermes-compiler',
      'hermesc',
      hermesOSBin(),
      hermesExecutableName(),
    );
    writeJson(
      path.join(tempRoot, 'node_modules/hermes-compiler/package.json'),
      {
        name: 'hermes-compiler',
        version: '250829098.0.10',
      },
    );
    _writeFile(hermesCommand);

    expect(resolveHermesCommand(tempRoot)).toBe(hermesCommand);
  });

  test('keeps compatibility with legacy react-native sdks hermesc path', () => {
    const hermesCommand = path.join(
      tempRoot,
      'node_modules',
      'react-native',
      'sdks',
      'hermesc',
      hermesOSBin(),
      hermesExecutableName(),
    );
    writeJson(path.join(tempRoot, 'node_modules/react-native/package.json'), {
      name: 'react-native',
      version: '0.69.0',
    });
    _writeFile(hermesCommand);

    expect(resolveHermesCommand(tempRoot)).toBe(hermesCommand);
  });

  test('keeps compatibility with legacy hermes-engine package path', () => {
    const hermesCommand = path.join(
      tempRoot,
      'node_modules',
      'hermes-engine',
      hermesOSBin(),
      hermesExecutableName(),
    );
    writeJson(path.join(tempRoot, 'node_modules/hermes-engine/package.json'), {
      name: 'hermes-engine',
      version: '0.11.0',
    });
    _writeFile(hermesCommand);

    expect(resolveHermesCommand(tempRoot)).toBe(hermesCommand);
  });
});

describe('buildSentrySourcemapsUploadArgs', () => {
  test('uses Debug ID references for current Sentry CLI versions', () => {
    const args = buildSentrySourcemapsUploadArgs({
      sentryCliPath: '/bin/sentry-cli',
      bundlePath: path.join('build/intermedia', 'index.android.bundle'),
      sourcemapPath: path.join('build/intermedia', 'index.android.bundle.map'),
      debugIdReference: true,
    });

    expect(args).toEqual([
      '/bin/sentry-cli',
      'sourcemaps',
      'upload',
      '--debug-id-reference',
      '--strip-prefix',
      process.cwd(),
      path.join('build/intermedia', 'index.android.bundle'),
      path.join('build/intermedia', 'index.android.bundle.map'),
    ]);
    expect(args).not.toContain('--release');
    expect(args).not.toContain('--dist');
  });

  test('keeps explicit release and dist for legacy upload fallback', () => {
    const args = buildSentrySourcemapsUploadArgs({
      sentryCliPath: '/bin/sentry-cli',
      bundlePath: path.join('build/intermedia', 'index.android.bundle'),
      sourcemapPath: path.join('build/intermedia', 'index.android.bundle.map'),
      release: 'com.example@1.0.0+10+pakta:hash',
      dist: 'pakta:hash',
    });

    expect(args).toEqual([
      '/bin/sentry-cli',
      'sourcemaps',
      'upload',
      '--release',
      'com.example@1.0.0+10+pakta:hash',
      '--dist',
      'pakta:hash',
      '--strip-prefix',
      process.cwd(),
      path.join('build/intermedia', 'index.android.bundle'),
      path.join('build/intermedia', 'index.android.bundle.map'),
    ]);
    expect(args).not.toContain('files');
    expect(args).not.toContain('upload-sourcemaps');
  });

  test('keeps the legacy releases files command for old Sentry CLI versions', () => {
    const args = buildSentrySourcemapsUploadArgs({
      sentryCliPath: '/bin/sentry-cli',
      bundlePath: path.join('build/intermedia', 'index.android.bundle'),
      sourcemapPath: path.join('build/intermedia', 'index.android.bundle.map'),
      release: 'com.example@1.0.0+10+pakta:hash',
      dist: 'pakta:hash',
      useStandaloneSourcemapsCommand: false,
    });

    expect(args).toEqual([
      '/bin/sentry-cli',
      'releases',
      'files',
      'com.example@1.0.0+10+pakta:hash',
      'upload-sourcemaps',
      '--dist',
      'pakta:hash',
      '--strip-prefix',
      process.cwd(),
      path.join('build/intermedia', 'index.android.bundle'),
      path.join('build/intermedia', 'index.android.bundle.map'),
    ]);
  });
});

describe('Sentry Debug ID upload mode', () => {
  let tempRoot = '';
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempRoot = mkTempDir('rn-update-sentry-debug-id-');
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('reads debugId from source maps', async () => {
    const sourcemapPath = path.join(tempRoot, 'index.bundlejs.map');
    writeJson(sourcemapPath, {
      version: 3,
      debugId: '85314830-023f-4cf1-a267-535f4e37bb17',
    });

    expect(await readSourcemapDebugId(sourcemapPath)).toBe(
      '85314830-023f-4cf1-a267-535f4e37bb17',
    );
  });

  test('prefers Debug ID upload when the source map has a Debug ID', async () => {
    const sourcemapPath = path.join(tempRoot, 'index.bundlejs.map');
    writeJson(sourcemapPath, {
      version: 3,
      debug_id: '85314830-023f-4cf1-a267-535f4e37bb17',
    });

    expect(await resolveSentryUploadMode(sourcemapPath)).toEqual({
      type: 'debug-id',
      debugId: '85314830-023f-4cf1-a267-535f4e37bb17',
    });
  });

  test('uses explicit release and dist before Debug ID for legacy self-hosted fallback', async () => {
    const sourcemapPath = path.join(tempRoot, 'index.bundlejs.map');
    writeJson(sourcemapPath, {
      version: 3,
      debug_id: '85314830-023f-4cf1-a267-535f4e37bb17',
    });

    expect(
      await resolveSentryUploadMode(sourcemapPath, {
        sentryRelease: 'com.example@1.0.0+10+pakta:4.1',
        sentryDist: 'pakta:4.1',
      }),
    ).toEqual({
      type: 'release',
      release: 'com.example@1.0.0+10+pakta:4.1',
      dist: 'pakta:4.1',
    });
  });

  test('falls back to explicit release and dist when no Debug ID exists', async () => {
    const sourcemapPath = path.join(tempRoot, 'index.bundlejs.map');
    writeJson(sourcemapPath, {
      version: 3,
    });

    expect(
      await resolveSentryUploadMode(sourcemapPath, {
        sentryRelease: 'com.example@1.0.0+10+pakta:hash',
        sentryDist: 'pakta:hash',
      }),
    ).toEqual({
      type: 'release',
      release: 'com.example@1.0.0+10+pakta:hash',
      dist: 'pakta:hash',
    });
  });

  test('uses SENTRY_RELEASE and SENTRY_DIST for legacy fallback', async () => {
    process.env.SENTRY_RELEASE = 'com.example@1.0.0+10+pakta:hash';
    process.env.SENTRY_DIST = 'pakta:hash';
    const sourcemapPath = path.join(tempRoot, 'index.bundlejs.map');
    writeJson(sourcemapPath, {
      version: 3,
    });

    expect(await resolveSentryUploadMode(sourcemapPath)).toEqual({
      type: 'release',
      release: 'com.example@1.0.0+10+pakta:hash',
      dist: 'pakta:hash',
    });
  });

  test('fails loudly when neither Debug ID nor explicit release is available', async () => {
    const sourcemapPath = path.join(tempRoot, 'index.bundlejs.map');
    writeJson(sourcemapPath, {
      version: 3,
    });

    await expect(resolveSentryUploadMode(sourcemapPath)).rejects.toThrow(
      'Generated source map does not contain a Debug ID',
    );
  });
});

describe('prepareSentryUploadArtifacts', () => {
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = mkTempDir('rn-update-sentry-artifacts-');
  });

  afterEach(() => {
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('aliases Android OTA bundles to the default Android bundle name', async () => {
    _writeFile(path.join(tempRoot, 'index.bundlejs'), 'bundle');
    writeJson(path.join(tempRoot, 'index.bundlejs.map'), {
      version: 3,
      file: 'index.bundlejs',
      sources: ['src/App.tsx'],
    });

    const artifacts = await prepareSentryUploadArtifacts(
      'index.bundlejs',
      tempRoot,
      'android',
    );

    expect(artifacts).toEqual({
      bundlePath: path.join(tempRoot, 'index.android.bundle'),
      sourcemapPath: path.join(tempRoot, 'index.android.bundle.map'),
    });
    expect(fs.readFileSync(artifacts.bundlePath, 'utf8')).toBe('bundle');
    expect(
      JSON.parse(fs.readFileSync(artifacts.sourcemapPath, 'utf8')),
    ).toEqual({
      version: 3,
      file: 'index.android.bundle',
      sources: ['src/App.tsx'],
    });
  });

  test('keeps non-Android artifacts unchanged', async () => {
    const artifacts = await prepareSentryUploadArtifacts(
      'index.bundlejs',
      tempRoot,
      'ios',
    );

    expect(artifacts).toEqual({
      bundlePath: path.join(tempRoot, 'index.bundlejs'),
      sourcemapPath: path.join(tempRoot, 'index.bundlejs.map'),
    });
  });
});

describe('buildHermescArgs', () => {
  test('always emits a hermes sourcemap so the bytecode debug info is stripped', () => {
    const bundlePath = '/tmp/out/index.bundlejs';
    expect(buildHermescArgs(bundlePath)).toEqual([
      '-emit-binary',
      '-out',
      bundlePath,
      bundlePath,
      '-O',
      '-output-source-map',
    ]);
  });
});

describe('summarizeHermescStderr', () => {
  const warning = [
    'index.bundlejs:204:115354: warning: the variable "clearTimeout" was not declared in anonymous function',
    `__d(function(e,n,t){${'x'.repeat(2000)}})`,
    `${' '.repeat(500)}^~~~~~~~~~~~~`,
  ].join('\n');

  test('surfaces the error instead of the warning noise around it', () => {
    const stderr = [
      warning,
      'index.bundlejs:1:1: error: base bytecode is not compatible',
      'var a = 1;',
      '^~~',
      warning,
    ].join('\n');
    expect(summarizeHermescStderr(stderr)).toBe(
      'index.bundlejs:1:1: error: base bytecode is not compatible',
    );
  });

  test('drops source and caret lines and caps the remaining length', () => {
    const summary = summarizeHermescStderr(warning);
    expect(summary).toContain('was not declared in anonymous function');
    expect(summary).not.toContain('__d(function');
    expect(summary.length).toBeLessThan(400);
  });

  test('keeps crash output that carries no error: prefix', () => {
    const stderr = `${warning}\nAssertion \`baseBCProvider\` failed.`;
    expect(summarizeHermescStderr(stderr)).toBe(
      'Assertion `baseBCProvider` failed.',
    );
  });

  test('returns an empty string for empty stderr', () => {
    expect(summarizeHermescStderr('')).toBe('');
  });
});

describe('assertSafeToEmpty', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  function directory(prefix: string): string {
    const root = mkTempDir(prefix);
    roots.push(root);
    return root;
  }

  test('returns the canonical path for dedicated build directories', () => {
    const cwd = directory('rnu-safe-project-');
    const inside = path.join(cwd, '.pakta', 'intermedia', 'ios');
    expect(assertSafeToEmpty(inside, cwd)).toBe(fs.realpathSync.native(inside));

    const outsideRoot = directory('rnu-safe-outside-');
    const outside = path.join(outsideRoot, 'build');
    expect(assertSafeToEmpty(outside, cwd)).toBe(
      fs.realpathSync.native(outside),
    );
  });

  test('refuses protected roots and source-control metadata', () => {
    const cwd = directory('rnu-safe-project-');
    fs.mkdirSync(path.join(cwd, '.git'), { recursive: true });

    expect(() => assertSafeToEmpty('.', cwd)).toThrow();
    expect(() => assertSafeToEmpty('..', cwd)).toThrow();
    expect(() => assertSafeToEmpty(cwd, cwd)).toThrow();
    expect(() => assertSafeToEmpty(os.homedir(), cwd)).toThrow();
    expect(() => assertSafeToEmpty(os.tmpdir(), cwd)).toThrow();
    expect(() => assertSafeToEmpty(path.parse(cwd).root, cwd)).toThrow();
    expect(() => assertSafeToEmpty(path.join(cwd, '.git'), cwd)).toThrow();
  });

  test('refuses final and parent-directory symlink redirection', () => {
    const cwd = directory('rnu-safe-project-');
    const outside = directory('rnu-safe-target-');
    _writeFile(path.join(outside, 'must-survive.txt'), 'important');

    const directLink = path.join(cwd, 'direct-link');
    fs.symlinkSync(
      outside,
      directLink,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    expect(() => assertSafeToEmpty(directLink, cwd)).toThrow();

    const parentLink = path.join(cwd, 'parent-link');
    fs.symlinkSync(
      outside,
      parentLink,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    expect(() =>
      assertSafeToEmpty(path.join(parentLink, 'build'), cwd),
    ).toThrow();
    expect(
      fs.readFileSync(path.join(outside, 'must-survive.txt'), 'utf8'),
    ).toBe('important');
  });
});

describe('detectHermesEnabled', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  /** a project directory declaring (and having installed) one RN version */
  function project(reactNativeVersion?: string): string {
    const root = mkTempDir('rn-update-hermes-detect-');
    roots.push(root);
    if (reactNativeVersion) {
      writeJson(path.join(root, 'package.json'), {
        dependencies: { 'react-native': `^${reactNativeVersion}` },
      });
      writeJson(
        path.join(root, 'node_modules', 'react-native', 'package.json'),
        { name: 'react-native', version: reactNativeVersion },
      );
    }
    return root;
  }

  test('android: gradle.properties decides first', async () => {
    const root = project('0.73.0');
    _writeFile(
      path.join(root, 'android', 'gradle.properties'),
      'hermesEnabled=false\n',
    );
    expect(
      await detectHermesEnabled(
        'android',
        undefined,
        { enableHermes: true },
        root,
      ),
    ).toBe(false);
    _writeFile(
      path.join(root, 'android', 'gradle.properties'),
      'hermesEnabled=true\n',
    );
    expect(await detectHermesEnabled('android', undefined, {}, root)).toBe(
      true,
    );
  });

  test('android: the legacy build.gradle switch when gradle.properties is silent', async () => {
    expect(
      await detectHermesEnabled(
        'android',
        undefined,
        { enableHermes: false },
        project('0.73.0'),
      ),
    ).toBe(false);
    expect(
      await detectHermesEnabled(
        'android',
        undefined,
        { enableHermes: true },
        project('0.68.2'),
      ),
    ).toBe(true);
  });

  test('android: React Native 0.71+ defaults to Hermes, older versions to JSC', async () => {
    expect(
      await detectHermesEnabled('android', undefined, {}, project('0.73.0')),
    ).toBe(true);
    expect(
      await detectHermesEnabled('android', undefined, {}, project('0.68.2')),
    ).toBe(false);
    // no react-native at all: nothing says Hermes
    expect(await detectHermesEnabled('android', undefined, {}, project())).toBe(
      false,
    );
  });

  test('ios: installed pod, Expo engine property or Podfile.lock', async () => {
    const root = project();
    expect(detectIosHermes(root)).toBe(false);

    const lock = path.join(root, 'ios', 'Podfile.lock');
    _writeFile(lock, 'PODS:\n  - React-Core (0.73.2)\n');
    expect(detectIosHermes(root)).toBe(false);
    _writeFile(
      lock,
      'PODS:\n  - hermes-engine (0.73.2):\n    - hermes-engine/Pre-built (= 0.73.2)\n  - React-Core (0.73.2)\n',
    );
    // no `pod install` on this machine, but the lockfile lists the pod
    expect(detectIosHermes(root)).toBe(true);

    const expoProperties = path.join(root, 'ios', 'Podfile.properties.json');
    writeJson(expoProperties, { 'expo.jsEngine': 'hermes' });
    fs.rmSync(lock);
    expect(detectIosHermes(root)).toBe(true);

    fs.rmSync(expoProperties);
    fs.mkdirSync(path.join(root, 'ios', 'Pods', 'hermes-engine'), {
      recursive: true,
    });
    expect(detectIosHermes(root)).toBe(true);
    expect(await detectHermesEnabled('ios', undefined, {}, root)).toBe(true);
  });

  test('ios: explicit JSC configuration overrides Hermes dependency artifacts', () => {
    const root = project();
    const ios = path.join(root, 'ios');
    fs.mkdirSync(path.join(ios, 'Pods', 'hermes-engine'), { recursive: true });
    _writeFile(
      path.join(ios, 'Podfile.lock'),
      'PODS:\n  - hermes-engine (0.83.0)\n',
    );

    writeJson(path.join(ios, 'Podfile.properties.json'), {
      'expo.jsEngine': 'jsc',
    });
    expect(detectIosHermes(root)).toBe(false);

    fs.rmSync(path.join(ios, 'Podfile.properties.json'));
    _writeFile(path.join(ios, 'Podfile'), "ENV['USE_HERMES'] = '0'\n");
    expect(detectIosHermes(root)).toBe(false);

    _writeFile(
      path.join(ios, 'Podfile'),
      "ENV['USE_THIRD_PARTY_JSC'] = '1'\nENV['USE_HERMES'] = '1'\n",
    );
    expect(detectIosHermes(root)).toBe(false);
  });

  test('ios: ignores commented-out Podfile engine settings', () => {
    const root = project();
    const ios = path.join(root, 'ios');
    fs.mkdirSync(path.join(ios, 'Pods', 'hermes-engine'), { recursive: true });
    _writeFile(
      path.join(ios, 'Podfile'),
      [
        "# ENV['USE_HERMES'] = '0'",
        "# ENV['USE_THIRD_PARTY_JSC'] = '1'",
        '# use_react_native!(:hermes_enabled => false)',
        'source "https://example.com/#pods"',
      ].join('\n'),
    );
    expect(detectIosHermes(root)).toBe(true);

    _writeFile(
      path.join(ios, 'Podfile'),
      ["ENV['USE_HERMES'] = '1'", "# ENV['USE_THIRD_PARTY_JSC'] = '1'"].join(
        '\n',
      ),
    );
    expect(detectIosHermes(root)).toBe(true);
  });

  test('ios: explicit Podfile Hermes configuration works without installed pods', () => {
    const root = project();
    _writeFile(
      path.join(root, 'ios', 'Podfile'),
      'use_react_native!(\n  :hermes_enabled => true\n)\n',
    );
    expect(detectIosHermes(root)).toBe(true);
  });

  test('forceHermes wins on every platform', async () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(await detectHermesEnabled('harmony', true, {}, project())).toBe(
        true,
      );
    } finally {
      logSpy.mockRestore();
    }
  });
});
