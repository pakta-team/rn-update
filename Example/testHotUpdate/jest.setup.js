/**
 * [INPUT]: 依赖 Jest 的 global 对象。
 * [OUTPUT]: 为 React Native 测试提供 window 与 dispatchEvent 兼容垫片。
 * [POS]: testHotUpdate 单测运行时初始化文件，不参与应用 bundle。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
global.window = global.window || global;

if (typeof global.window.dispatchEvent !== 'function') {
  global.window.dispatchEvent = () => false;
}
