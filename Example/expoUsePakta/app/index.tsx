/**
 * [INPUT]: 依赖 Expo Router 的文件路由约定与上级 App.tsx 根页面。
 * [OUTPUT]: 对外提供 Expo Router 根路由组件，复用 Pakta 更新验证页面。
 * [POS]: expoUsePakta 的路由适配边界，隔离 Router 入口变化与业务页面实现。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import App from '../App';

export default App;
