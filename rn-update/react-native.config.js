/**
 * [INPUT]: 依赖 React Native CLI 对根 react-native.config.js 的加载约定
 * [OUTPUT]: 导出空配置对象，显式保留默认 autolinking 行为并提供稳定 CLI 配置入口
 * [POS]: 仓库根原生链接配置边界；当前无额外平台覆盖，不复制自动链接逻辑
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
module.exports = {};
