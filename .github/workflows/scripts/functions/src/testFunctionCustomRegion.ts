/**
 * [INPUT]: 依赖 firebase-functions callable API 与 europe-west1 区域配置。
 * [OUTPUT]: 导出 testFunctionCustomRegion callable function，固定返回区域标识。
 * [POS]: Firebase 部署区域回归夹具，用于验证客户端可调用指定区域函数。
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

import * as functions from 'firebase-functions';

export const testFunctionCustomRegion = functions
  .region('europe-west1')
  .https.onCall(() => 'europe-west1');
