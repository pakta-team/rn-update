/**
 * [INPUT]: 依赖 rn-update/package.json 的发布版本与 DevEco/Hvigor 的 BuildProfile 读取约定
 * [OUTPUT]: 对外提供 HAR_VERSION、构建模式和 target 常量及兼容默认类
 * [POS]: Harmony HAR 发布元数据边界，与 oh-package.json5 的 version 保持同构
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/**
 * Use these variables when you tailor your ArkTS code. They must be of the const type.
 */
export const HAR_VERSION = '1.1.0';
export const BUILD_MODE_NAME = 'release';
export const DEBUG = false;
export const TARGET_NAME = 'default';

/**
 * BuildProfile Class is used only for compatibility purposes.
 */
export default class BuildProfile { 
	static readonly HAR_VERSION = HAR_VERSION;
	static readonly BUILD_MODE_NAME = BUILD_MODE_NAME;
	static readonly DEBUG = DEBUG;
	static readonly TARGET_NAME = TARGET_NAME;
}
