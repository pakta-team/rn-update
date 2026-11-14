import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('depVersions utility', () => {
  const originalCwd = process.cwd();
  let testDir: string;
  let testCount = 0;
  let cwdSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    testCount++;
    testDir = path.join(
      os.tmpdir(),
      `temp-test-dep-versions-${Date.now()}-${testCount}`,
    );
    fs.mkdirSync(testDir, { recursive: true });

    // Mock process.cwd() instead of using process.chdir() to avoid affecting parallel tests
    cwdSpy = spyOn(process, 'cwd').mockReturnValue(testDir);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  const loadDepVersions = async () => {
    // Bust the module cache by appending a query string
    // In Bun, using the raw absolute path with query string correctly bypasses the cache
    const modulePath = path.join(
      originalCwd,
      'src',
      'utils',
      'dep-versions.ts',
    );
    const moduleUrl = `${modulePath}?t=${Date.now()}_${testCount}`;
    const module = await import(moduleUrl);
    return module.getDepVersions();
  };

  test('resolves lazily and once', async () => {
    fs.writeFileSync(
      path.join(testDir, 'package.json'),
      JSON.stringify({ dependencies: { lazy: '^1.0.0' } }),
    );
    const lazyDir = path.join(testDir, 'node_modules', 'lazy');
    fs.mkdirSync(lazyDir, { recursive: true });
    fs.writeFileSync(
      path.join(lazyDir, 'package.json'),
      JSON.stringify({ version: '1.2.3' }),
    );

    const modulePath = path.join(
      originalCwd,
      'src',
      'utils',
      'dep-versions.ts',
    );
    const module = await import(`${modulePath}?lazy=${Date.now()}`);
    // importing must not read anything: cwd is only consulted on first use
    expect(cwdSpy).not.toHaveBeenCalled();

    expect(module.getDepVersions()).toEqual({ lazy: '1.2.3' });

    // memoized while the project directory is unchanged
    expect(module.getDepVersions()).toBe(module.getDepVersions());
  });

  test('re-resolves the cache after the project cwd changes', async () => {
    const secondDir = path.join(
      os.tmpdir(),
      `temp-test-dep-versions-second-${Date.now()}-${testCount}`,
    );
    fs.mkdirSync(secondDir, { recursive: true });
    try {
      for (const [root, name, version] of [
        [testDir, 'first', '1.0.0'],
        [secondDir, 'second', '2.0.0'],
      ] as const) {
        fs.writeFileSync(
          path.join(root, 'package.json'),
          JSON.stringify({ dependencies: { [name]: '*' } }),
        );
        const depDir = path.join(root, 'node_modules', name);
        fs.mkdirSync(depDir, { recursive: true });
        fs.writeFileSync(
          path.join(depDir, 'package.json'),
          JSON.stringify({ version }),
        );
      }

      const modulePath = path.join(
        originalCwd,
        'src',
        'utils',
        'dep-versions.ts',
      );
      const module = await import(
        `${modulePath}?cwd=${Date.now()}_${testCount}`
      );
      expect(module.getDepVersions()).toEqual({ first: '1.0.0' });

      cwdSpy.mockReturnValue(secondDir);
      expect(module.getDepVersions()).toEqual({ second: '2.0.0' });
      expect(module.getDepVersion('second')).toBe('2.0.0');
    } finally {
      fs.rmSync(secondDir, { recursive: true, force: true });
    }
  });

  test('should return an empty object if no package.json is found', async () => {
    // testDir has no package.json
    const deps = await loadDepVersions();
    expect(deps).toEqual({});
  });

  test('should return an empty object if package.json has no dependencies or devDependencies', async () => {
    fs.writeFileSync(
      path.join(testDir, 'package.json'),
      JSON.stringify({ name: 'test-app' }),
    );

    const deps = await loadDepVersions();
    expect(deps).toEqual({});
  });

  test('should resolve versions for dependencies and devDependencies and sort keys', async () => {
    fs.writeFileSync(
      path.join(testDir, 'package.json'),
      JSON.stringify({
        dependencies: {
          zeta: '^1.0.0',
          alpha: '^2.0.0',
        },
        devDependencies: {
          beta: '^3.0.0',
        },
      }),
    );

    const depsToCreate = [
      { name: 'zeta', version: '1.0.5' },
      { name: 'alpha', version: '2.1.0' },
      { name: 'beta', version: '3.0.1' },
    ];

    for (const dep of depsToCreate) {
      const depDir = path.join(testDir, 'node_modules', dep.name);
      fs.mkdirSync(depDir, { recursive: true });
      fs.writeFileSync(
        path.join(depDir, 'package.json'),
        JSON.stringify({ version: dep.version }),
      );
    }

    const deps = await loadDepVersions();

    // Check that versions are resolved
    expect(deps).toEqual({
      alpha: '2.1.0',
      beta: '3.0.1',
      zeta: '1.0.5',
    });

    // Check that keys are sorted alphabetically
    const keys = Object.keys(deps);
    expect(keys).toEqual(['alpha', 'beta', 'zeta']);
  });

  test('should skip dependencies that cannot be resolved without throwing an error', async () => {
    fs.writeFileSync(
      path.join(testDir, 'package.json'),
      JSON.stringify({
        dependencies: {
          exists: '^1.0.0',
          missing: '^2.0.0',
        },
      }),
    );

    // Only create 'exists'
    const existsDir = path.join(testDir, 'node_modules', 'exists');
    fs.mkdirSync(existsDir, { recursive: true });
    fs.writeFileSync(
      path.join(existsDir, 'package.json'),
      JSON.stringify({ version: '1.0.0' }),
    );

    const deps = await loadDepVersions();
    expect(deps).toEqual({
      exists: '1.0.0',
    });
  });

  test('getDepVersion answers for one direct dependency without the whole map', async () => {
    fs.writeFileSync(
      path.join(testDir, 'package.json'),
      JSON.stringify({ dependencies: { direct: '^1.0.0' } }),
    );
    for (const [name, version] of [
      ['direct', '1.2.3'],
      ['transitive', '9.9.9'],
    ]) {
      const dir = path.join(testDir, 'node_modules', name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ version }),
      );
    }

    const modulePath = path.join(
      originalCwd,
      'src',
      'utils',
      'dep-versions.ts',
    );
    const module = await import(`${modulePath}?t=${Date.now()}_${testCount}_1`);
    expect(module.getDepVersion('direct')).toBe('1.2.3');
    // installed but not declared by the project: not a project dependency
    expect(module.getDepVersion('transitive')).toBeUndefined();
    expect(module.getDepVersion('missing')).toBeUndefined();
  });

  test('should deduplicate dependencies appearing in both dependencies and devDependencies', async () => {
    fs.writeFileSync(
      path.join(testDir, 'package.json'),
      JSON.stringify({
        dependencies: {
          shared: '^1.0.0',
        },
        devDependencies: {
          shared: '^1.0.0',
        },
      }),
    );

    const sharedDir = path.join(testDir, 'node_modules', 'shared');
    fs.mkdirSync(sharedDir, { recursive: true });
    fs.writeFileSync(
      path.join(sharedDir, 'package.json'),
      JSON.stringify({ version: '1.0.2' }),
    );

    const deps = await loadDepVersions();
    expect(deps).toEqual({
      shared: '1.0.2',
    });
  });
});
