import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getCommitInfo } from '../src/utils/git';

const originalCwd = process.cwd();

function runGit(args: string[], cwd: string) {
  execFileSync('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test Author',
      GIT_AUTHOR_EMAIL: 'author@example.com',
      GIT_COMMITTER_NAME: 'Test Committer',
      GIT_COMMITTER_EMAIL: 'committer@example.com',
    },
    stdio: 'ignore',
  });
}

describe('utils/git', () => {
  let tempRoot = '';

  afterEach(() => {
    process.chdir(originalCwd);
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
    tempRoot = '';
  });

  test('returns undefined commit info outside of a git repository', async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-update-no-git-'));
    process.chdir(tempRoot);

    await expect(getCommitInfo()).resolves.toBeUndefined();
  });

  test('reads commit info using git executable', async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-update-git-'));
    runGit(['init'], tempRoot);
    runGit(
      ['remote', 'add', 'origin', 'https://example.com/demo.git'],
      tempRoot,
    );
    fs.writeFileSync(path.join(tempRoot, 'README.md'), 'hello\n');
    runGit(['add', 'README.md'], tempRoot);
    runGit(['commit', '-m', 'Initial commit'], tempRoot);
    process.chdir(tempRoot);

    const commit = await getCommitInfo();

    expect(commit?.hash).toMatch(/^[0-9a-f]{40}$/);
    expect(commit?.message).toBe('Initial commit');
    expect(commit?.author).toBe('Test Author');
    expect(commit?.timestamp).toMatch(/^\d+$/);
    expect(commit?.origin).toBe('https://example.com/demo.git');
  });
});
