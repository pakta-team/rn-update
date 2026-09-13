/**
 * [INPUT]: 依赖 @ohos/hvigor-ohos-plugin 的 appTasks
 * [OUTPUT]: 对外提供 HAR 包装工程的默认 Hvigor system/plugins 配置
 * [POS]: har-wrapper 构建入口，只编排应用级产品，不实现 pakta 更新运行时
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {appTasks} from '@ohos/hvigor-ohos-plugin';

export default {
  system: appTasks,
  plugins: [],
};
