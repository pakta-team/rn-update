/**
 * [INPUT]: 依赖 React Native AppRegistry、app.json 应用名与 App.tsx 根组件。
 * [OUTPUT]: 注册 harmony_use_pakta 的 JavaScript 根组件。
 * [POS]: 普通 RN/Harmony 消费端 Metro 入口，连接原生 Ability 与页面层。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
