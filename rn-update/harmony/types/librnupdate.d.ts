/**
 * [INPUT]: 依赖 NAPI librnupdate.so 的 native module 加载名
 * [OUTPUT]: 对外提供 librnupdate.so 的 unknown 默认导出声明
 * [POS]: types 原生模块防腐边界，具体状态/补丁/update-flow 方法由 NativePatchCore 收窄
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
// Type stub for the native NAPI module. The real binding surface is typed in
// pakta/src/main/ets/NativePatchCore.ts (NativePatchCoreBindings).
declare module 'librnupdate.so' {
  const bindings: unknown;
  export default bindings;
}
