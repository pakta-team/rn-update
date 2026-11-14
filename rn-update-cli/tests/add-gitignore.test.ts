import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { addGitIgnore } from '../src/utils/add-gitignore';
import { credentialFile, tempDir } from '../src/utils/constants';

const originalCwd = process.cwd();

function mkTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function readGitIgnore(cwd: string): string {
  return fs.readFileSync(path.join(cwd, '.gitignore'), 'utf-8');
}

describe('utils/add-gitignore', () => {
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = mkTempDir('rn-update-gitignore-');
    process.chdir(tempRoot);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('does nothing when .gitignore does not exist', () => {
    addGitIgnore();
    expect(fs.existsSync(path.join(tempRoot, '.gitignore'))).toBe(false);
  });

  test('appends required ignore entries when missing', () => {
    fs.writeFileSync(path.join(tempRoot, '.gitignore'), 'node_modules\n');

    addGitIgnore();

    const content = readGitIgnore(tempRoot);
    expect(content).toContain('# rn-update');
    expect(content).toContain(credentialFile);
    expect(content).toContain(tempDir);
  });

  test('does not duplicate entries that already exist', () => {
    fs.writeFileSync(
      path.join(tempRoot, '.gitignore'),
      ['node_modules', credentialFile].join('\n'),
    );

    addGitIgnore();
    const first = readGitIgnore(tempRoot);
    addGitIgnore();
    const second = readGitIgnore(tempRoot);

    expect(second).toEqual(first);

    const lines = second.split('\n');
    expect(lines.filter((line) => line.trim() === credentialFile)).toHaveLength(
      1,
    );
  });
});

describe('utils/add-gitignore pattern variants', () => {
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = mkTempDir('rn-update-gitignore-variants-');
    process.chdir(tempRoot);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('treats anchored and directory forms as already ignored', () => {
    const original = [`/${credentialFile}`, `${tempDir}/`, ''].join('\n');
    fs.writeFileSync(path.join(tempRoot, '.gitignore'), original);

    addGitIgnore();

    expect(readGitIgnore(tempRoot)).toBe(original);
  });

  test('a trailing slash does not cover the credential file', () => {
    // `.update/` only matches a directory, but the token is a file
    fs.writeFileSync(
      path.join(tempRoot, '.gitignore'),
      [`${credentialFile}/`, tempDir].join('\n'),
    );

    addGitIgnore();

    const lines = readGitIgnore(tempRoot).split('\n');
    expect(lines).toContain(credentialFile);
    expect(lines.filter((line) => line === tempDir)).toHaveLength(1);
  });
});
