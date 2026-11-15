/**
 * [INPUT]: 依赖显式 HAR 摘要、TAR 成员及短工程的 OHPM 清单/锁/物理安装树
 * [OUTPUT]: 提供 HAR 全文件清单与严格依赖复用证明；不匹配时直接失败，不安装或修改工程
 * [POS]: Harmony 构建输入门卫；只有当前项目消费同一 HAR 时才允许跳过耗时的 OHPM 刷新
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { assertDigest, requireFile } = require('./harmony-e2e-sdk');

const TAR_BLOCK = 512;
const MAX_HAR_BYTES = 256 * 1024 * 1024;

function json5(source) {
  // stage 必须能在依赖安装前运行，只有复用门卫才加载解析器。
  return require('json5').parse(source);
}

function readJson5(file) {
  return json5(fs.readFileSync(requireFile(file), 'utf8'));
}

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function tarNumber(header, start, length) {
  const text = header
    .subarray(start, start + length)
    .toString('ascii')
    .replace(/\0.*$/, '')
    .trim();
  if (!/^[0-7]+$/.test(text)) throw new Error('Invalid HAR TAR number');
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value)) throw new Error('HAR TAR number overflow');
  return value;
}

// ---------- 只读 TAR：拒绝链接、路径别名及不完整清单，不向磁盘解包 ----------
function harInventory(file) {
  const archive = zlib.gunzipSync(fs.readFileSync(requireFile(file)), {
    maxOutputLength: MAX_HAR_BYTES,
  });
  const files = new Map();
  const names = new Set();
  let metadata;
  let ended = false;
  for (let offset = 0; offset < archive.length; ) {
    if (offset + TAR_BLOCK > archive.length)
      throw new Error('Truncated HAR TAR header');
    const header = archive.subarray(offset, offset + TAR_BLOCK);
    if (header.every((byte) => byte === 0)) {
      if (
        archive.length - offset < TAR_BLOCK * 2 ||
        !archive.subarray(offset).every((byte) => byte === 0)
      )
        throw new Error('Invalid HAR TAR terminator');
      ended = true;
      break;
    }
    const checksum = tarNumber(header, 148, 8);
    const actual = header.reduce(
      (sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte),
      0
    );
    if (checksum !== actual) throw new Error('Invalid HAR TAR checksum');
    const field = (start, size) =>
      header
        .subarray(start, start + size)
        .toString('utf8')
        .replace(/\0.*$/, '');
    const prefix = field(345, 155);
    const name = `${prefix ? `${prefix}/` : ''}${field(0, 100)}`;
    const type = header[156];
    const directory = type === 53;
    const member = directory ? name.replace(/\/$/, '') : name;
    if (
      !(member.startsWith('package/') || (directory && member === 'package')) ||
      /[\\:\ufffd]/.test(member) ||
      [...member].some(
        (letter) => letter.charCodeAt(0) < 32 || letter.charCodeAt(0) === 127
      ) ||
      member.split('/').some((part) => !part || part === '.' || part === '..')
    )
      throw new Error(`Unsafe HAR member path: ${name}`);
    const relative =
      member === 'package' ? '' : member.slice('package/'.length);
    const identity = relative.toLowerCase();
    if (names.has(identity))
      throw new Error(`Duplicate HAR member path: ${relative}`);
    names.add(identity);
    if (type !== 0 && type !== 48 && !directory)
      throw new Error(`Unsupported HAR member type: ${relative}`);
    const size = tarNumber(header, 124, 12);
    const contentStart = offset + TAR_BLOCK;
    const next = contentStart + Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;
    if (next > archive.length || (directory && size !== 0))
      throw new Error('Truncated or invalid HAR TAR member');
    if (!directory) {
      const bytes = archive.subarray(contentStart, contentStart + size);
      files.set(relative, digest(bytes));
      if (relative === 'oh-package.json5')
        metadata = json5(bytes.toString('utf8'));
    }
    offset = next;
  }
  if (!ended || !files.size || metadata?.name !== 'pakta' || !metadata.version)
    throw new Error('HAR must contain a complete Pakta package');
  for (const relative of files.keys()) {
    for (let parent = path.posix.dirname(relative); parent !== '.'; ) {
      if (files.has(parent)) throw new Error('HAR file shadows a directory');
      parent = path.posix.dirname(parent);
    }
  }
  return { files, version: metadata.version };
}

function within(root, target) {
  const relative = path.relative(root, target);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function installedInventory(root) {
  const files = new Map();
  function visit(directory, relative = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink() || !within(root, fs.realpathSync(file)))
        throw new Error(
          `Installed HAR member escapes physical package: ${name}`
        );
      if (stat.isDirectory()) visit(file, name);
      else if (stat.isFile()) files.set(name, digest(fs.readFileSync(file)));
      else throw new Error(`Unsupported installed HAR member: ${name}`);
    }
  }
  visit(root);
  return files;
}

function assertReusableDependencies(ctx) {
  const project = fs.realpathSync(ctx.project);
  const stagedHar = path.join(project, 'pakta.har');
  assertDigest(ctx.har, ctx.env.RNU_HARMONY_HAR_SHA256, 'HAR candidate');
  const harSha256 = assertDigest(
    stagedHar,
    ctx.env.RNU_HARMONY_HAR_SHA256,
    'Staged HAR candidate'
  );
  if (fs.realpathSync(stagedHar) !== stagedHar)
    throw new Error('Reusable HAR must be a physical file in current project');
  const manifest = readJson5(path.join(project, 'entry', 'oh-package.json5'));
  if (manifest.dependencies?.pakta !== 'file:../pakta.har')
    throw new Error('Reusable Pakta dependency must be file:../pakta.har');
  const lock = readJson5(path.join(project, 'entry', 'oh-package-lock.json5'));
  const key = 'pakta@../pakta.har';
  const specifiers = Object.keys(lock.specifiers || {}).filter((name) =>
    name.startsWith('pakta@')
  );
  const packages = Object.entries(lock.packages || {}).filter(
    ([name, value]) => name.startsWith('pakta@') || value?.name === 'pakta'
  );
  const locked = lock.packages?.[key];
  if (
    specifiers.length !== 1 ||
    specifiers[0] !== key ||
    lock.specifiers[key] !== key ||
    packages.length !== 1 ||
    packages[0][0] !== key ||
    locked?.name !== 'pakta' ||
    locked.registryType !== 'local' ||
    locked.resolved !== '../pakta.har'
  )
    throw new Error(
      'Reusable Pakta lock must resolve current project ../pakta.har'
    );
  const store = fs.realpathSync(path.join(project, 'oh_modules', '.ohpm'));
  const installed = fs.realpathSync(
    path.join(project, 'entry', 'oh_modules', 'pakta')
  );
  if (!within(project, store) || !within(store, installed))
    throw new Error('Reusable Pakta must reside in current project OHPM store');
  const expected = harInventory(stagedHar);
  const metadata = readJson5(path.join(installed, 'oh-package.json5'));
  if (
    metadata.name !== 'pakta' ||
    metadata.version !== expected.version ||
    locked.version !== expected.version
  )
    throw new Error(
      'Reusable Pakta HAR, installation and lock versions differ'
    );
  const actual = installedInventory(installed);
  if (
    actual.size !== expected.files.size ||
    [...expected.files].some(([name, sha]) => actual.get(name) !== sha)
  )
    throw new Error('Reusable Pakta files differ from complete current HAR');
  return {
    harSha256,
    version: expected.version,
    files: actual.size,
    installed,
  };
}

module.exports = { harInventory, assertReusableDependencies };
