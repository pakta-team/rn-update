/**
 * [INPUT]: 依赖 RNOH RNOHPackage 与 PaktaPackageFactory 工厂映射
 * [OUTPUT]: 对外提供新 RNOH PaktaPackage，注册 Pakta TurboModule 工厂
 * [POS]: Harmony 新架构 Package 注册边界，不承载更新状态或文件事务
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {
  RNOHPackage,
} from '@rnoh/react-native-openharmony';
import { createPaktaTurboModuleFactoryMap } from './PaktaPackageFactory';

export class PaktaPackage extends RNOHPackage {
  override getUITurboModuleFactoryByNameMap() {
    return createPaktaTurboModuleFactoryMap();
  }
}
