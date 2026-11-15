#!/usr/bin/env node
/**
 * [INPUT]: 依赖显式宿主/CLI、现有 brick/fix 入口、RN/Expo Hermes 编译与共享 ZIP 完整性门卫
 * [OUTPUT]: 提供独立 brick/fix full PPK、完整摘要及宿主/CLI/入口构建证明，不重建 APK
 * [POS]: 真坏 JS 救援制品边界；仅复制验收入口到宿主，不改原生工程、不复用其他 RN 版本的 HBC
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { verifyZip } = require('./verify-update-artifacts');

async function prepare({
  project,
  cli,
  output,
  platform = 'android',
  bundler = 'react-native',
}) {
  if (!['android', 'ios'].includes(platform))
    throw new Error('Expected android or ios');
  if (!['react-native', 'expo'].includes(bundler))
    throw new Error('Expected react-native or expo');
  const projectRoot = fs.realpathSync(project);
  const cliRoot = fs.realpathSync(cli);
  const destination = path.resolve(output);
  if (fs.existsSync(destination))
    throw new Error(`Choose a fresh output directory: ${destination}`);
  const packageJson = (root, name) =>
    JSON.parse(
      fs.readFileSync(
        require.resolve(`${name}/package.json`, { paths: [root] }),
        'utf8'
      )
    );
  const reactNative = packageJson(projectRoot, 'react-native').version;
  const sdk = packageJson(projectRoot, 'rn-update').version;
  const cliPackage = JSON.parse(
    fs.readFileSync(path.join(cliRoot, 'package.json'), 'utf8')
  );
  const cliBin =
    typeof cliPackage.bin === 'string' ? cliPackage.bin : cliPackage.bin?.pakta;
  if (!cliBin || !fs.existsSync(path.join(cliRoot, cliBin)))
    throw new Error('CLI must be built first');
  const entries = {};
  const { readFirstEntry } = require(
    path.join(cliRoot, 'lib/utils/zip-entries.js')
  );
  const { HBC_MAGIC } = require(
    path.join(cliRoot, 'lib/utils/hbcTransform.js')
  );
  const hash = (bytes) =>
    crypto.createHash('sha256').update(bytes).digest('hex');
  for (const name of [
    'entry.brick.ts',
    'entry.fix.ts',
    'entry.rescue-fix.ts',
  ]) {
    const source = path.resolve(__dirname, '..', 'e2e', name);
    const target = path.join(projectRoot, 'e2e', name);
    const bytes = fs.readFileSync(source);
    if (fs.existsSync(target) && !fs.readFileSync(target).equals(bytes))
      throw new Error(
        `Existing rescue entry differs; review it before replacement: ${target}`
      );
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!fs.existsSync(target)) fs.writeFileSync(target, bytes);
    entries[name] = hash(bytes);
  }
  fs.mkdirSync(destination, { recursive: true });
  const proof = {
    project: projectRoot,
    cli: cliRoot,
    platform,
    bundler,
    reactNative,
    sdk,
    cliVersion: cliPackage.version,
    entries,
    files: {},
    status: 'building',
  };
  fs.writeFileSync(
    path.join(destination, 'build-proof.json'),
    `${JSON.stringify(proof, null, 2)}\n`
  );
  for (const [name, entry] of [
    ['brick.ppk', 'entry.brick.ts'],
    ['fix.ppk', 'entry.rescue-fix.ts'],
  ]) {
    const target = path.join(destination, name);
    const result = spawnSync(
      process.execPath,
      [
        path.join(cliRoot, cliBin),
        'bundle',
        '--platform',
        platform,
        '--entryFile',
        `e2e/${entry}`,
        '--dev',
        'false',
        bundler === 'expo' ? '--expo' : '--rncli',
        '--hermes',
        '--hermesBase',
        'none',
        '--output',
        target,
        '--no-interactive',
      ],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        timeout: 300000,
        maxBuffer: 8 * 1024 * 1024,
        env: {
          ...process.env,
          NO_INTERACTIVE: 'true',
          RNU_AUTO_UPDATE: '0',
          RNU_METRO_MAX_WORKERS: '1',
        },
      }
    );
    fs.writeFileSync(
      path.join(destination, `${name}.build.log`),
      `${result.stdout || ''}${result.stderr || ''}`
    );
    if (result.error || result.status !== 0)
      throw (
        result.error ||
        new Error(`${name} bundle failed (${result.status}); see build log`)
      );
    if (
      !fs.statSync(target).size ||
      !/Hermes enabled, now compiling|Hermes 已启用/.test(result.stdout)
    )
      throw new Error(`${name} did not prove a nonempty Hermes build`);
    await verifyZip(target, platform, 'full');
    const bundle = await readFirstEntry(
      target,
      (file) => file === 'index.bundlejs'
    );
    if (
      !bundle ||
      bundle.length < 12 ||
      !bundle.subarray(0, 8).equals(HBC_MAGIC)
    )
      throw new Error(`${name} is not a Hermes HBC bundle`);
    proof.files[name] = {
      bytes: fs.statSync(target).size,
      sha256: hash(fs.readFileSync(target)),
      bundleSha256: hash(bundle),
      hermesVersion: bundle.readUInt32LE(8),
    };
  }
  proof.status = 'built';
  fs.writeFileSync(
    path.join(destination, 'build-proof.json'),
    `${JSON.stringify(proof, null, 2)}\n`
  );
  return proof;
}

if (require.main === module) {
  const options = {};
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index];
    if (
      !['--project', '--cli', '--output', '--platform', '--bundler'].includes(
        key
      ) ||
      !process.argv[index + 1]
    )
      throw new Error(
        'Usage: prepare-crash-rescue-artifacts.js --project DIR --cli DIR --output FRESH_DIR [--platform android|ios] [--bundler react-native|expo]'
      );
    options[key.slice(2)] = process.argv[index + 1];
  }
  for (const key of ['project', 'cli', 'output'])
    if (!options[key]) throw new Error(`--${key} is required`);
  prepare(options).then(
    (proof) => console.log(JSON.stringify(proof, null, 2)),
    (error) => {
      console.error(error);
      process.exitCode = 1;
    }
  );
}
module.exports = { prepare };
