/**
 * [INPUT]: 依赖 Node fs 的普通二进制文件读取，或调用者提供的 Buffer
 * [OUTPUT]: 提供 findWording/findBufferWording 及逐文件 CLI 门禁，拒绝上游品牌残留
 * [POS]: scripts 的原生身份检查，被 Android verifier 与 HAR 检查复用；构建路径由平台编译配置裁剪
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
'use strict';

const fs = require('fs');

const WORDING = /pushy|react-native-update/i;
const MIN_LENGTH = 4;

function findBufferWording(buffer) {
  const hits = [];
  let start = -1;
  for (let i = 0; i <= buffer.length; i++) {
    const byte = i < buffer.length ? buffer[i] : 0;
    const printable = byte >= 0x20 && byte < 0x7f;
    if (printable && start < 0) {
      start = i;
    } else if (!printable && start >= 0) {
      if (i - start >= MIN_LENGTH) {
        const run = buffer.toString('latin1', start, i);
        if (WORDING.test(run)) hits.push(run);
      }
      start = -1;
    }
  }
  return hits;
}

function findWording(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error('not a regular binary file');
  const buffer = fs.readFileSync(file);
  if (buffer.length === 0) throw new Error('empty binary file');
  return findBufferWording(buffer);
}

module.exports = { findWording, findBufferWording };

if (require.main === module) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('usage: check-binary-strings.js <binary>...');
    process.exit(2);
  }
  let failed = false;
  for (const file of files) {
    try {
      const hits = findWording(file);
      if (hits.length) {
        failed = true;
        for (const hit of hits) {
          console.error(`error: ${file} contains forbidden wording ${JSON.stringify(hit)}`);
        }
      } else {
        console.log(`ok: ${file} has no forbidden upstream identity in its strings`);
      }
    } catch (error) {
      failed = true;
      console.error(`error: ${file}: ${error.message}`);
    }
  }
  process.exitCode = failed ? 1 : 0;
}
