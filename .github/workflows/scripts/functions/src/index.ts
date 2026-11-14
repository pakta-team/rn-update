/**
 * [INPUT]: 依赖 firebase-functions runtime，以及默认/自定义区域 callable 实现。
 * [OUTPUT]: 导出 helloWorld、testFunctionDefaultRegion 与 testFunctionCustomRegion。
 * [POS]: Firebase Functions 的唯一公共导出面，被 Emulator 与 CI 集成测试加载。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import * as functions from 'firebase-functions';

// // Start writing Firebase Functions
// // https://firebase.google.com/docs/functions/typescript
//
export const helloWorld = functions.https.onRequest((request, response) => {
  functions.logger.info('Hello logs!', { structuredData: true });
  response.send('{ "data": "Hello from Firebase!" }');
});

export { testFunctionCustomRegion } from './testFunctionCustomRegion';
export { testFunctionDefaultRegion } from './testFunctionDefaultRegion';
