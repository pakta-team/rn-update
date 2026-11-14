/**
 * [INPUT]: 依赖 CocoaPods 暴露的 React Clang module 与 Expo 条件 subspec 的公共头配置
 * [OUTPUT]: 对外提供单一 React umbrella import，供 Swift/Objective-C 消费端跨 React/React-Core 头布局编译
 * [POS]: ios 公共头兼容边界，只消解依赖头路径差异，不声明更新业务 API
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
@import React;

