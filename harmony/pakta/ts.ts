/**
 * [INPUT]: 依赖 src/main/ets 的旧 RNOH TypeScript PackageCompat 与 TurboModule
 * [OUTPUT]: 对外提供兼容入口的 PaktaPackage 和 PaktaTurboModule 类型/实现
 * [POS]: pakta 旧 RNOH 消费路径，保持与 index.ets 的新入口同一业务实现
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

export * from './src/main/ets/PaktaPackageCompat'
export * from './src/main/ets/PaktaTurboModule'
