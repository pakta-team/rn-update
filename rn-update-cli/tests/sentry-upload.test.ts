/**
 * [INPUT]: 依赖 uploadSourcemapForSentry、临时 @sentry/cli 进程夹具与环境隔离
 * [OUTPUT]: 提供 Sentry 单次能力探测、Debug ID 上传及旧 release 回退回归
 * [POS]: CLI source map 上传的进程协作边界，以真实子进程验证命令顺序，不访问 Sentry 服务
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { uploadSourcemapForSentry } from '../src/bundle-runner';

// -- 子进程夹具：记录参数并模拟各代 sentry-cli 能力及上传失败 --
const FAKE_CLI = `
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../../..');
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'sentry-fixture.json'), 'utf8'));
const args = process.argv.slice(2);
fs.appendFileSync(path.join(root, 'calls.log'), JSON.stringify(args) + '\\n');
if (args.includes('--help')) {
  if (fixture.help === 'missing') process.exit(1);
  console.log(fixture.help === 'full'
    ? 'Usage: --release --dist --debug-id-reference'
    : 'Usage: --release --dist');
  process.exit(0);
}
if (args.includes('--debug-id-reference') && fixture.debugFailure) {
  process.exit(2);
}
`;

describe('uploadSourcemapForSentry process contract', () => {
  let root = '';
  let cwd = '';
  const savedEnv: Record<string, string | undefined> = {};
  const envKeys = ['SENTRY_RELEASE', 'SENTRY_DIST'];
  let logSpy: ReturnType<typeof spyOn>;
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pakta-sentry-'));
    const bin = path.join(root, 'node_modules', '@sentry', 'cli', 'bin');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'sentry-cli'), FAKE_CLI);
    fs.mkdirSync(path.join(root, 'out'));
    fs.writeFileSync(path.join(root, 'out', 'index.bundlejs'), 'code');
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    cwd = process.cwd();
    process.chdir(root);
    logSpy = spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(cwd);
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    logSpy.mockRestore();
    warnSpy.mockRestore();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const writeMap = (extra: Record<string, unknown> = {}) =>
    fs.writeFileSync(
      path.join(root, 'out', 'index.bundlejs.map'),
      JSON.stringify({ version: 3, sources: [], mappings: '', ...extra }),
    );
  const configureCli = (help: string, debugFailure = false) =>
    fs.writeFileSync(
      path.join(root, 'sentry-fixture.json'),
      JSON.stringify({ help, debugFailure }),
    );
  const calls = () =>
    fs
      .readFileSync(path.join(root, 'calls.log'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => (JSON.parse(line) as string[]).slice(0, 4).join(' '));
  const upload = (options = {}) =>
    uploadSourcemapForSentry(
      'index.bundlejs',
      path.join(root, 'out'),
      'index.bundlejs.map',
      'ios',
      options,
    );

  test('uploads by Debug ID after a single --help probe', async () => {
    writeMap({ debugId: 'abc' });
    configureCli('full');
    await upload();
    expect(calls()).toEqual([
      'sourcemaps upload --help',
      'sourcemaps upload --debug-id-reference --strip-prefix',
    ]);
  });

  test('falls back to SENTRY_RELEASE without --debug-id-reference support', async () => {
    writeMap({ debugId: 'abc' });
    configureCli('legacy-flags');
    process.env.SENTRY_RELEASE = 'r1';
    await upload();
    expect(calls()).toEqual([
      'sourcemaps upload --help',
      'releases set-commits r1 --auto',
      'sourcemaps upload --release r1',
    ]);
  });

  test('uses releases files upload-sourcemaps without the standalone command', async () => {
    writeMap();
    configureCli('missing');
    await upload({ sentryRelease: 'r2' });
    expect(calls()).toEqual([
      'sourcemaps upload --help',
      'releases set-commits r2 --auto',
      'releases files r2 upload-sourcemaps',
    ]);
  });

  test('retries a failed Debug ID upload with SENTRY_RELEASE', async () => {
    writeMap({ debugId: 'abc' });
    configureCli('full', true);
    process.env.SENTRY_RELEASE = 'r3';
    await upload();
    expect(calls()).toEqual([
      'sourcemaps upload --help',
      'sourcemaps upload --debug-id-reference --strip-prefix',
      'releases set-commits r3 --auto',
      'sourcemaps upload --release r3',
    ]);
  });
});
