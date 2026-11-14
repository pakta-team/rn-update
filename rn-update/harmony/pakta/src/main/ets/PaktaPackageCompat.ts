/**
 * [INPUT]: 依赖旧 RNOH RNPackage/ts 类型与 PaktaPackageFactory 工厂映射
 * [OUTPUT]: 对外提供兼容旧 RNOH 的 PaktaPackage
 * [POS]: Harmony 旧宿主 Package 适配器，与新入口共享同一 TurboModule 构造逻辑
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {
  RNPackage,
} from '@rnoh/react-native-openharmony/ts';
import { createPaktaTurboModuleFactoryMap } from './PaktaPackageFactory';

export class PaktaPackage extends RNPackage {
  override getUITurboModuleFactoryByNameMap() {
    return createPaktaTurboModuleFactoryMap();
  }
}
