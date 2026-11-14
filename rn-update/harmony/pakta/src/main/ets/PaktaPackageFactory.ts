/**
 * [INPUT]: 依赖旧 RNOH UITurboModule/Context 类型与 PaktaTurboModule.NAME/构造器
 * [OUTPUT]: 对外提供 createPaktaTurboModuleFactoryMap，将 Pakta 名称映射到唯一实现
 * [POS]: Harmony Package 与 TurboModule 的依赖倒置边界，集中模块发现避免新旧 Package 重复注册规则
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {
  UITurboModule,
  UITurboModuleContext,
} from '@rnoh/react-native-openharmony/ts';
import { PaktaTurboModule } from './PaktaTurboModule';

export function createPaktaTurboModuleFactoryMap(): Map<
  string,
  (ctx: UITurboModuleContext) => UITurboModule | null
> {
  return new Map<string, (ctx: UITurboModuleContext) => UITurboModule | null>([
    [PaktaTurboModule.NAME, (ctx) => new PaktaTurboModule(ctx)],
  ]);
}
