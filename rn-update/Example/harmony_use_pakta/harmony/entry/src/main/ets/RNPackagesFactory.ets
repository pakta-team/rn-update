/**
 * [INPUT]: 依赖 RNOH RNPackage 类型与 pakta 包导出的 PaktaPackage。
 * [OUTPUT]: 导出 createRNPackages(ctx)，返回供 RNApp 装配的 Pakta RNPackage 列表。
 * [POS]: ArkTS 包装层，与 C++ PackageProvider 保持同一 Pakta 能力的双端注册语义。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { RNPackageContext, RNPackage } from '@rnoh/react-native-openharmony';
import PaktaPackage from 'pakta';

export function createRNPackages(ctx: RNPackageContext): RNPackage[] {
  return [new PaktaPackage(ctx)];
}
