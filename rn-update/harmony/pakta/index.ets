/**
 * [INPUT]: 依赖 src/main/ets 的 RNOH Package、TurboModule、文件 bundle provider 与无桥宿主类型
 * [OUTPUT]: 对外导出 PaktaPackage、PaktaTurboModule、PaktaFileJSBundleProvider 与 NativeUpdateResult/NativeUpdateConfig 类型的 HAR 公共入口
 * [POS]: pakta 包级稳定表面，隔离消费端对内部目录布局的依赖；无桥宿主 API 类型经此对宿主可见
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export { PaktaPackage as default } from './src/main/ets/PaktaPackage';
export { PaktaPackage } from './src/main/ets/PaktaPackage';
export { PaktaTurboModule } from './src/main/ets/PaktaTurboModule';
export { PaktaFileJSBundleProvider } from './src/main/ets/PaktaFileJSBundleProvider';
export type { NativeUpdateResult } from './src/main/ets/NativeUpdateResult';
export type { NativeUpdateConfig } from './src/main/ets/NativeUpdateConfig';
