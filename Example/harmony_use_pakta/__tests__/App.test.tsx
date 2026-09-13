/**
 * [INPUT]: 依赖 App.tsx 与 react-test-renderer/Jest 的 React Native 测试运行时。
 * [OUTPUT]: 提供 App 根组件可挂载的渲染 smoke 断言。
 * [POS]: 普通 RN 消费端单测边界，不替代 Harmony HAP 设备测试。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 * @format
 */

import 'react-native';

// Note: import explicitly to use the types shiped with jest.
import { it } from '@jest/globals';
// Note: test renderer must be required after react-native.
import renderer from 'react-test-renderer';
import App from '../App';

it('renders correctly', () => {
  renderer.create(<App />);
});
