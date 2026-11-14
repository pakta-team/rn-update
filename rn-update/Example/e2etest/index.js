/**
 * [INPUT]: 依赖 React Native AppRegistry 与 src/index.tsx 应用组件
 * [OUTPUT]: 对外提供 AwesomeProject 的原生 bundle 注册入口
 * [POS]: e2etest 运行时最外层启动壳，平台工程通过它加载样例 UI
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/**
 * @format
 */

import { AppRegistry } from 'react-native';
import { name as appName } from './app.json';
import App from './src';

AppRegistry.registerComponent(appName, () => App);
