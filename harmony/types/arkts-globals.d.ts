/**
 * [INPUT]: 依赖 ArkTS/ets-loader 注入的运行时全局语义与 plain tsc 的环境缺口
 * [OUTPUT]: 对外提供 console 和定时器的最小 ambient 声明
 * [POS]: types 编译期补丁层，避免把完整 Harmony 工具链强行带入普通 TypeScript 检查
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
// Minimal ambient declarations for ArkTS runtime globals used by the pakta
// sources. In real builds these are injected by ets-loader (see the SDK's
// api/@internal/full/global.d.ts, which is module-scoped and thus not usable
// directly as an ambient lib for plain tsc).
declare class console {
  static debug(message: string, ...arguments: any[]): void;
  static log(message: string, ...arguments: any[]): void;
  static info(message: string, ...arguments: any[]): void;
  static warn(message: string, ...arguments: any[]): void;
  static error(message: string, ...arguments: any[]): void;
}

declare function setTimeout(
  handler: Function | string,
  delay?: number,
  ...arguments: any[]
): number;
declare function clearTimeout(timeoutID?: number): void;
declare function setInterval(
  handler: Function | string,
  delay: number,
  ...arguments: any[]
): number;
declare function clearInterval(intervalID?: number): void;
