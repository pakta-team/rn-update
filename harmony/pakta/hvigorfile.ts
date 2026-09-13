/**
 * [INPUT]: 依赖 @ohos/hvigor-ohos-plugin 的 harTasks
 * [OUTPUT]: 对外提供 pakta HAR 默认构建任务入口
 * [POS]: pakta 交付构建壳，只负责插件接入，不承载 ArkTS 更新行为
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export { harTasks } from '@ohos/hvigor-ohos-plugin';
