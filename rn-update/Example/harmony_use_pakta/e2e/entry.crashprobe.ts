/**
 * [INPUT]: 依赖 AppRegistry、e2e/app.tsx 与 Harmony JS 运行时异常处理。
 * [OUTPUT]: 注册 e2e App，并在延迟窗口抛出未捕获异常以探测进程生存语义。
 * [POS]: Harmony crash-rescue 实验入口，独立于常规 full/diff 更新轨道。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
// §11 Harmony crash-semantics probe (not part of the regular e2e suites):
// does an uncaught JS error in release kill the whole process (the
// Android/iOS behaviour the crash rescue exists for), or does RNOH survive
// it? Thrown at +1s — before the native check's 5s delay — so a surviving
// process also proves the orchestrator round outlives JS death.
import { AppRegistry } from 'react-native';
import { name as appName } from '../app.json';
import App from './app';

setTimeout(() => {
  throw new Error('HM_CRASH_PROBE: uncaught JS error at +1s');
}, 1000);

AppRegistry.registerComponent(appName, () => App);
