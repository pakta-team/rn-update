/**
 * [INPUT]: 依赖 Node 子进程参数、Hermes CLI API 和异步错误事件
 * [OUTPUT]: 对外提供隔离执行夹具，报告取消、编译结果及晚到的 rejection/exception
 * [POS]: tests/fixtures 的进程生命周期探针，不属于生产运行时
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

/**
 * Run async-error regressions outside the test runner under either Bun or Node.
 * Listeners remain installed until natural exit: even errors after the result
 * marker make the child fail. A parent deadline also detects leaked handles.
 */
const assert = require('node:assert/strict');
const path = require('node:path');

const unexpected = [];
/** Record both Promise rejections and uncaught ChildProcess error events. */
function recordUnexpected(kind, error) {
  unexpected.push(kind);
  process.exitCode = 1;
  console.error(`HERMES_ASYNC_ERROR ${kind}: ${String(error)}`);
}
process.on('unhandledRejection', (error) =>
  recordUnexpected('unhandledRejection', error),
);
process.on('uncaughtException', (error) =>
  recordUnexpected('uncaughtException', error),
);

/** Exercise the actual API, then allow timers and immediates to report errors. */
async function main() {
  const config = JSON.parse(process.argv[2]);
  if (config.cwd) process.chdir(config.cwd);
  let result;
  if (config.operation === 'abort') {
    const { compareHermesBytecode } = require(path.resolve(config.modulePath));
    const controller = new AbortController();
    controller.abort();
    result = await compareHermesBytecode(
      config.command || process.execPath,
      'missing-a',
      'missing-b',
      { signal: controller.signal, timeoutMs: 500 },
    );
    assert.equal(result.status, 'dump-failed');
    assert.match(result.detail, /abort/i);
  } else if (config.operation === 'verify') {
    const { compareHermesBytecode } = require(path.resolve(config.modulePath));
    const controller = new AbortController();
    let timer;
    if (config.abortAfterMs === 0) controller.abort();
    else if (config.abortAfterMs !== undefined) {
      timer = setTimeout(() => controller.abort(), config.abortAfterMs);
    }
    try {
      result = await compareHermesBytecode(
        config.command,
        'missing-a',
        'missing-b',
        { ...config.options, signal: controller.signal },
      );
      assert.equal(result.status, 'dump-failed');
    } finally {
      clearTimeout(timer);
    }
  } else if (config.operation === 'compile') {
    const { compileHermesByteCode } = require(path.resolve(config.modulePath));
    result = await compileHermesByteCode(config.options);
  } else if (config.operation === 'control-rejection') {
    setImmediate(() => Promise.reject(new Error('intentional rejection')));
  } else if (config.operation === 'control-exception') {
    setImmediate(() => {
      throw new Error('intentional exception');
    });
  } else {
    throw new Error(`Unknown operation: ${config.operation}`);
  }
  // Checking only immediately after await can miss later-turn error delivery.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(unexpected, []);
  console.log(`HERMES_ASYNC_RESULT ${JSON.stringify(result)}`);
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
