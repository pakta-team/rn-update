#!/usr/bin/env node
/**
 * [INPUT]: 依赖已编译 ZIP 工厂、Node 文件流与 yauzl 完整条目读取
 * [OUTPUT]: 提供 WSL 挂载盘隐式 write/writev 偏移丢失的确定性 Node 回归
 * [POS]: CLI Node 烟雾测试的归档门卫；注入内核偏移故障并验证内存/文件两种首条均逐字节保留
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createOutputZip, readFirstEntry } = require('../lib/utils/zip-entries');

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rnu-zip-offset-'));
  const writev = fs.writev;
  const createWriteStream = fs.createWriteStream;
  let opened;
  let batchWrites = 0;
  fs.createWriteStream = function (...args) {
    const stream = createWriteStream.apply(this, args);
    opened = new Promise((resolve, reject) => {
      stream.once('open', resolve);
      stream.once('error', reject);
    });
    return stream;
  };
  // --- 模拟 WSL 挂载盘：write 后的隐式 writev 从零偏移覆盖 ---
  fs.writev = function (fd, buffers, position, callback) {
    batchWrites += 1;
    if (typeof position === 'function') {
      return writev.call(this, fd, buffers, 0, position);
    }
    return writev.call(this, fd, buffers, position ?? 0, callback);
  };
  try {
    const payload = Buffer.from('HDIFFSF20&fixture\0payload');
    const manifest = Buffer.from('{"copies":{},"deletes":{}}');
    const source = path.join(dir, 'payload.bin');
    fs.writeFileSync(source, payload);
    for (const kind of ['buffer', 'file']) {
      const output = path.join(dir, `${kind}.ppk.patch`);
      const { zipfile, writePromise, abort } = createOutputZip(output);
      try {
        // 等输出 fd 打开，首头走 write，后续块才能触发 writev。
        await opened;
        if (kind === 'buffer') {
          zipfile.addBuffer(payload, 'bundle.harmony.js.patch', {
            compress: false,
          });
        } else {
          zipfile.addFile(source, 'bundle.harmony.js.patch', {
            compress: false,
          });
        }
        zipfile.addBuffer(manifest, '__diff.json', { compress: false });
        zipfile.end();
        await writePromise;
        assert.equal(fs.readFileSync(output).readUInt32LE(0), 0x04034b50);
        assert.deepEqual(
          await readFirstEntry(
            output,
            (name) => name === 'bundle.harmony.js.patch',
          ),
          payload,
        );
        assert.deepEqual(
          await readFirstEntry(output, (name) => name === '__diff.json'),
          manifest,
        );
      } catch (error) {
        await abort();
        throw error;
      }
    }
    assert.ok(batchWrites > 0, 'regression must exercise batched writev');
    console.log(
      'smoke: ZIP buffer/file entries survive lost implicit writev offset',
    );
  } finally {
    fs.writev = writev;
    fs.createWriteStream = createWriteStream;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
