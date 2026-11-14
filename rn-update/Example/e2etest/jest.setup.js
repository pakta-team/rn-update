/**
 * [INPUT]: 依赖 Jest 全局对象与 React Native 测试环境约定
 * [OUTPUT]: 对外提供 window/dispatchEvent 等最小测试替身
 * [POS]: 样例单元测试的环境初始化层，不影响真实应用运行时
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
global.window = global.window || global;

if (typeof global.window.dispatchEvent !== 'function') {
  global.window.dispatchEvent = () => false;
}
