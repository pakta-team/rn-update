#!/usr/bin/env node
/**
 * [INPUT]: 依赖显式Android宿主/CLI/APK/设备、独立制品准备器、共享服务和Python设备驱动
 * [OUTPUT]: 编排单宿主真实坏JS救援，绑定APK/制品身份并保留日志与结果，退出时关闭自有服务
 * [POS]: 本机和CI共用的设备入口；可复用已证明制品，不写SDK状态、不重建原生APK
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { prepare } = require('./prepare-crash-rescue-artifacts');
const { createRescueServer } = require('./crash-rescue-server');

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

async function runPython(python, args, logFile) {
  // ---------- 异步等待子进程，保留HTTP服务的事件循环 ----------
  const descriptor = fs.openSync(logFile, 'wx');
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(python, args, { stdio: ['ignore', descriptor, descriptor] });
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        if (code === 0) resolve();
        else reject(new Error(`Python driver failed (${code ?? signal}); see ${logFile}`));
      });
    });
  } finally {
    fs.closeSync(descriptor);
  }
}

async function run(options) {
  const project = fs.realpathSync(options.project);
  const cli = fs.realpathSync(options.cli);
  const apk = fs.realpathSync(options.apk);
  const output = path.resolve(options.output);
  const apkSha = digest(apk);
  if (options['apk-sha256'] && options['apk-sha256'].toLowerCase() !== apkSha)
    throw new Error('APK differs from the supplied SHA-256');
  if (fs.existsSync(output)) throw new Error('Choose a fresh output directory');
  fs.mkdirSync(output, { recursive: true });
  const artifacts = options.artifacts
    ? fs.realpathSync(options.artifacts)
    : path.join(output, 'artifacts');
  const python = options.python || (process.platform === 'win32' ? 'python' : 'python3');
  const runId = crypto.randomUUID();
  const result = { status: 'running', runId, project, cli, apk, apkSha256: apkSha,
    artifacts, githubSHA: process.env.GITHUB_SHA || null };
  let server;
  try {
    if (!options.artifacts)
      await prepare({ project, cli, output: artifacts, platform: 'android',
        bundler: options.bundler || 'react-native' });
    const proof = JSON.parse(fs.readFileSync(path.join(artifacts, 'build-proof.json'), 'utf8'));
    if (proof.status !== 'built' || proof.platform !== 'android' ||
        fs.realpathSync(proof.project) !== project || fs.realpathSync(proof.cli) !== cli)
      throw new Error('Prepared artifacts do not belong to this Android host and CLI');
    result.artifactBuild = proof;
    const args = [path.join(__dirname, 'drive-android-crash-rescue.py'),
      '--serial', options.serial, '--package', options.package, '--apk', apk,
      '--apk-sha256', apkSha, '--artifacts', artifacts, '--run-id', runId,
      '--adb', options.adb || 'adb'];
    await runPython(python, [...args, '--evidence-dir', path.join(output, 'input-validation'),
      '--verify-only'], path.join(output, 'input-validation.log'));
    const owned = createRescueServer({ artifacts, runId,
      evidenceFile: path.join(output, 'server-state.json') });
    server = owned.server;
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(31337, '0.0.0.0', resolve);
    });
    await runPython(python, [...args, '--evidence-dir', path.join(output, 'device')],
      path.join(output, 'device-driver.log'));
    const device = JSON.parse(fs.readFileSync(path.join(output, 'device/result.json'), 'utf8'));
    if (device.status !== 'passed' || device.crashRescue !== true)
      throw new Error('Device driver did not prove native crash rescue');
    if (digest(apk) !== apkSha) throw new Error('APK changed during the device run');
    for (const name of ['brick.ppk', 'fix.ppk'])
      if (digest(path.join(artifacts, name)) !== proof.files[name].sha256)
        throw new Error(`${name} changed during the device run`);
    result.status = 'passed';
    result.inputsUnchanged = true;
    result.deviceResult = path.join(output, 'device/result.json');
  } catch (error) {
    result.status = 'failed';
    result.error = String(error.stack || error);
    throw error;
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    fs.writeFileSync(path.join(output, 'run-result.json'), JSON.stringify(result, null, 2) + '\n');
  }
  return result;
}

if (require.main === module) {
  const options = {};
  const names = ['project', 'cli', 'apk', 'apk-sha256', 'serial', 'package', 'output',
    'artifacts', 'bundler', 'python', 'adb'];
  for (let index = 2; index < process.argv.length; index += 2) {
    const name = process.argv[index].replace(/^--/, '');
    if (!process.argv[index].startsWith('--') || !names.includes(name) || !process.argv[index + 1])
      throw new Error('Expected named --project/--cli/--apk/--serial/--package/--output arguments');
    options[name] = process.argv[index + 1];
  }
  for (const name of ['project', 'cli', 'apk', 'serial', 'package', 'output'])
    if (!options[name]) throw new Error(`--${name} is required`);
  if (!['com.awesomeproject', 'space.yoghourt.pakta.expoprobe'].includes(options.package))
    throw new Error('Only the dedicated Android E2E application IDs may be reset');
  run(options).then((result) => process.stdout.write(JSON.stringify(result) + '\n'),
    (error) => { console.error(error); process.exitCode = 1; });
}

module.exports = { run };
