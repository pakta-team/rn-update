#!/usr/bin/env node
/**
 * [INPUT]: 依赖本地 contract.json、contract-schema、contract-targets 与 node:fs/path
 * [OUTPUT]: 提供 planGeneration/generate 及命令入口；全部预检后仅写漂移声明，--check 只读并以非零退出码拒绝漂移
 * [POS]: scripts 的 T08 常量派生入口，保留分区外字节和原换行符，不被生产运行时导入
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const fs = require('node:fs');
const path = require('node:path');
const { validateContract } = require('./contract-schema');
const { targets } = require('./contract-targets');

const defaultRoot = path.resolve(__dirname, '..');

function planGeneration(root = defaultRoot, contract = JSON.parse(fs.readFileSync(path.join(__dirname, 'contract.json'), 'utf8'))) {
  validateContract(contract);
  const files = new Map();
  const ownership = new Map();
  for (const partition of targets(contract)) {
    const absolute = path.resolve(root, partition.file);
    if (!absolute.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error(`outside root: ${partition.file}`);
    if (fs.lstatSync(absolute).isSymbolicLink()) throw new Error(`symlink target: ${partition.file}`);
    if (!files.has(partition.file)) {
      const original = fs.readFileSync(absolute, 'utf8');
      files.set(partition.file, { original, generated: original });
    }
    const file = files.get(partition.file);
    const matches = [...file.generated.matchAll(partition.pattern)];
    if (matches.length !== 1) throw new Error(`${partition.file} [${partition.owner}]: expected one owned declaration, found ${matches.length}`);
    const identity = `${partition.file}:${matches[0][0]}`;
    if (ownership.has(identity)) throw new Error(`overlapping ownership: ${partition.file}`);
    ownership.set(identity, partition.owner);
    const newline = file.original.includes('\r\n') ? '\r\n' : '\n';
    file.generated = file.generated.replace(partition.pattern, () => partition.content.replace(/\n/g, newline));
  }
  return files;
}

function generate({ root = defaultRoot, contract, check = false } = {}) {
  const plan = planGeneration(root, contract);
  const changed = [...plan].filter(([, file]) => file.original !== file.generated);
  if (!check) for (const [name, file] of changed) fs.writeFileSync(path.join(root, name), file.generated);
  return changed.map(([name]) => name);
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== '--check') || args.length > 1) throw new Error('usage: node scripts/generate-contract.js [--check]');
    const check = args.includes('--check');
    const changed = generate({ check });
    if (check && changed.length) {
      process.stderr.write(`contract drift:\n${changed.join('\n')}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write(check ? 'contract check passed\n' : `contract generated: ${changed.length} files\n`);
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { generate, planGeneration };
