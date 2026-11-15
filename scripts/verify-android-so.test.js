/**
 * [INPUT]: 依赖 Node 测试/VM 与 verify-android-so 的真实源码，只读加载四 ABI 发布库
 * [OUTPUT]: 对外提供 20 项 JNI 定义、四项退役桥消失与逐 ABI 缺导出负控
 * [POS]: scripts 的 Android 产物接口回归，内存变异验证守卫而不写发布库
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'verify-android-so.js'), 'utf8');
const prefix = 'Java_cn_reactnative_modules_update_NativeUpdateFlow_';
const retired = ['buildCheckRequestBody', 'orderEndpointCandidates',
  'handleCheckResponse', 'isValidCheckResponse'];
const active = ['stepRound', 'runnableConfig', 'normalizeConfiguration',
  'configsEquivalent', 'hostCancellation'];
const abis = ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64'];

test('四 ABI 发布库只保留 20 个 JNI 定义且不含旧 flow 导出', () => {
  for (const abi of abis) {
    const data = fs.readFileSync(path.join(__dirname, '..', 'android', 'lib', abi, 'librnupdate.so'));
    for (const name of retired) assert.equal(data.indexOf(prefix + name + '\0'), -1);
    const names = data.toString('latin1').match(/Java_cn_reactnative_modules_update_[A-Za-z0-9_]+(?=\0)/g);
    assert.equal(new Set(names).size, 20);
  }
});

function verify(missing, targetAbi) {
  const errors = [];
  let exitCode = 0;
  const filesystem = {
    statSync: fs.statSync,
    readFileSync(file) {
      const data = Buffer.from(fs.readFileSync(file));
      if (targetAbi && path.basename(path.dirname(file)) !== targetAbi) return data;
      for (const name of missing) {
        const bytes = Buffer.from(prefix + name + '\0');
        let offset = data.indexOf(bytes);
        while (offset !== -1) {
          data[offset] = 88;
          offset = data.indexOf(bytes, offset + bytes.length);
        }
      }
      return data;
    },
  };
  vm.runInNewContext(source, {
    require(name) { return name === 'fs' ? filesystem : require(name); },
    __dirname,
    Buffer,
    console: { log() {}, error(message) { errors.push(message); } },
    process: { argv: ['node', 'verify-android-so.js'], exit(code) { exitCode = code; } },
  });
  return { exitCode, errors };
}

test('四 ABI 不再要求四个旧 flow JNI，必需清单精确为 20 项', () => {
  const required = source.match(/const REQUIRED_SYMBOLS = \[([\s\S]*?)\];/)[1];
  assert.equal((required.match(/'Java_/g) || []).length, 20);
  for (const name of retired) assert.ok(!required.includes(prefix + name));
  assert.deepEqual(verify(retired), { exitCode: 0, errors: [] });
});

for (const abi of abis) {
  for (const name of active) {
    test(`${abi} 缺少新桥 ${name} 必须失败`, () => {
      const result = verify([name], abi);
      assert.equal(result.exitCode, 1);
      assert.ok(result.errors.some(message => message.includes(`does not export ${prefix}${name}`)));
    });
  }
}
