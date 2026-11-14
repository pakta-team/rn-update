/**
 * [INPUT]: 依赖 sample-data 模块，并兼容旧版 CommonJS 测试工具加载方式。
 * [OUTPUT]: 导出 SAMPLE_DATA 共享样本对象。
 * [POS]: Firebase 夹具的兼容导出层，不是 Functions runtime 的 HTTP/callable 入口。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/*
 *
 *  Testing tools for invertase/react-native-firebase use only.
 *
 *  Copyright (C) 2018-present Invertase Limited <oss@invertase.io>
 *
 *  See License file for more information.
*/

/* eslint-disable global-require */
module.exports = {
  SAMPLE_DATA: require('./functions/sample-data'),
};
