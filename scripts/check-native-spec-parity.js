#!/usr/bin/env node
/**
 * [INPUT]: 依赖 native-binding-parity 的只读四端签名检查与生成物校验
 * [OUTPUT]: 保持现有 lint 入口，T09 参数、委托、方法表或生成物漂移即失败
 * [POS]: scripts 的跨端方法契约命令入口，不执行生成或修复
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
try {
  const methods = require('./native-binding-parity').check(
    require('path').resolve(__dirname, '..')
  );
  console.log(
    `check-native-spec-parity: ${methods.length} methods checked across android (old+new arch), ios and harmony`
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
