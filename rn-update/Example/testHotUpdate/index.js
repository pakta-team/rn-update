/**
 * [INPUT]: 依赖 React Native AppRegistry、app.json 的应用名和 src/index.tsx 根组件。
 * [OUTPUT]: 注册 AwesomeProject 的 JavaScript 启动组件。
 * [POS]: testHotUpdate 的 Metro/RN 构建入口，连接原生宿主与页面层。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 * @format
 */

import { AppRegistry } from 'react-native';
import { name as appName } from './app.json';
import App from './src';

AppRegistry.registerComponent(appName, () => App);
