/**
 * [INPUT]: 依赖 src/index.tsx，并以 Jest mock 隔离相机、SVG、Paper 与 rn-update。
 * [OUTPUT]: 提供 App 根组件可渲染的最小回归断言。
 * [POS]: testHotUpdate 消费端测试边界，只验证页面装配，不验证真实网络或原生制品。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 * @format
 */

import 'react-native';
import renderer, { act } from 'react-test-renderer';
import App from '../src';

jest.mock('react-native-camera-kit', () => ({
  Camera: 'Camera',
}));

jest.mock('react-native-svg/css', () => ({
  LocalSvg: 'LocalSvg',
}));

jest.mock('../src/TestConsole', () => 'TestConsole');

jest.mock('react-native-paper', () => {
  const _React = require('react');
  const { Text, TouchableOpacity, View } = require('react-native');

  return {
    Icon: (props) => <View {...props} />,
    PaperProvider: ({ children }) => <>{children}</>,
    Snackbar: ({ children }) => <View>{children}</View>,
    Banner: ({ children }) => <View>{children}</View>,
    Button: ({ children, onPress, title, ...props }) => (
      <TouchableOpacity onPress={onPress} {...props}>
        <Text>{children ?? title}</Text>
      </TouchableOpacity>
    ),
    Modal: ({ children, visible }) =>
      visible ? <View>{children}</View> : null,
    Portal: ({ children }) => <>{children}</>,
  };
});

jest.mock('rn-update', () => {
  const _React = require('react');

  return {
    Pakta: function Pakta() {
      return {
        setOptions: jest.fn(),
        version: 'test-version',
      };
    },
    UpdateProvider: ({ children }) => children,
    useUpdate: () => ({
      client: {
        setOptions: jest.fn(),
        version: 'test-version',
      },
      checkUpdate: jest.fn(),
      downloadUpdate: jest.fn(),
      switchVersionLater: jest.fn(),
      switchVersion: jest.fn(),
      updateInfo: null,
      packageVersion: '1.0.0',
      currentHash: '',
      parseTestQrCode: jest.fn(),
      progress: {},
      currentVersionInfo: null,
    }),
  };
});

it('renders correctly', async () => {
  let tree;

  await act(async () => {
    tree = renderer.create(<App />);
  });

  expect(tree.toJSON()).toBeTruthy();
});
