/**
 * [INPUT]: 依赖 Hvigor hapTasks 与仓库内 harmony/hvigor-plugin 的 reactNativeUpdatePlugin。
 * [OUTPUT]: 导出 entry HAP 构建任务，并把本地更新资源处理接入构建链。
 * [POS]: Harmony 消费端构建与 SDK 资源同步的边界入口。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {hapTasks} from '@ohos/hvigor-ohos-plugin';
import {reactNativeUpdatePlugin} from '../../../../harmony/hvigor-plugin';

export default {
  system: hapTasks /* Built-in plugin of Hvigor. It cannot be modified. */,
  plugins: [
    reactNativeUpdatePlugin(),
  ] /* Custom plugin to extend the functionality of Hvigor. */,
};
