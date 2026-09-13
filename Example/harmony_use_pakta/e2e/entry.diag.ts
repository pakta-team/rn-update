/**
 * [INPUT]: 依赖 PaktaModule 的 RNOH 暴露面、app.json 名称与 e2e/app.tsx。
 * [OUTPUT]: 输出 syncNativeConfig/getConstants 诊断并注册可运行的 e2e App。
 * [POS]: Harmony 原生桥探针入口，仅用于定位 TurboModule 暴露差异，不属于常规更新轨道。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
// Diagnostic entry: why does syncNativeConfig never run on RNOH?
import { AppRegistry } from 'react-native';
import { PaktaModule } from 'rn-update';
import { name as appName } from '../app.json';
import App from './app';

const mod = PaktaModule as unknown as Record<string, unknown>;
console.error(
  `RNU_DIAG typeof syncNativeConfig=${typeof mod.syncNativeConfig} ` +
    `typeof getConstants=${typeof mod.getConstants} ` +
    `keys=${JSON.stringify(Object.keys(mod)).slice(0, 300)}`
);
Promise.resolve()
  .then(() => (mod.syncNativeConfig as (c: string) => Promise<void>)('{"probe":true}'))
  .then(() => console.error('RNU_DIAG direct syncNativeConfig call OK'))
  .catch((e: Error) => console.error(`RNU_DIAG direct call failed: ${e.message}`));

AppRegistry.registerComponent(appName, () => App);
