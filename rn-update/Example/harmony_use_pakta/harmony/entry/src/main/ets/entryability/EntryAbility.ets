/**
 * [INPUT]: 依赖 RNOH RNAbility 基类。
 * [OUTPUT]: 提供 EntryAbility，并把默认页面路径指向 pages/Index。
 * [POS]: Harmony Ability 生命周期入口，承接 ArkUI 根页面与 RNOH 实例。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {RNAbility} from '@rnoh/react-native-openharmony';

export default class EntryAbility extends RNAbility {
  override getPagePath() {
    return 'pages/Index';
  }
}
