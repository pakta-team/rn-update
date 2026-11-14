/**
 * [INPUT]: 依赖 React Native AppRegistry、app.json 名称与 e2e/app.tsx。
 * [OUTPUT]: 注册 Harmony e2e 基线 bundle 的根组件。
 * [POS]: 所有更新轨道的共同启动入口，不改变 bundle label 或原生配置。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { AppRegistry } from 'react-native';
import { name as appName } from '../app.json';
import App from './app';

AppRegistry.registerComponent(appName, () => App);
