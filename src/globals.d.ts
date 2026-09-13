/**
 * [INPUT]: 依赖 Metro/React Native 在运行时注入的开发模式标志
 * [OUTPUT]: 对 TypeScript 全局提供只读的 __DEV__ 布尔声明
 * [POS]: src 的编译环境契约，使业务代码无需污染模块依赖即可安全分支开发态行为
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
declare const __DEV__: boolean;
