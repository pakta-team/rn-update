/**
 * [INPUT]: 依赖 scripts/generate-flow-vectors 的 TypeScript 参考实现，以及 cpp/update_flow_core/tests/flow_vectors.json 的已提交黄金向量
 * [OUTPUT]: 提供 JS 与 C++ 更新流决策语义的文件级一致性断言，阻止生成物与参考实现分叉
 * [POS]: __tests__ 的跨语言契约入口，连接 src/updateFlowCore 与 cpp/update_flow_core，不承担业务副作用
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { describe, expect, test } from 'bun:test';
import vectorsFile from '../../cpp/update_flow_core/tests/flow_vectors.json';
import { buildVectors } from '../../scripts/generate-flow-vectors';

describe('flow golden vectors', () => {
  // The committed vectors are the parity contract between src/updateFlowCore.ts
  // (reference) and cpp/update_flow_core (port, replayed by test:flow-core).
  // A semantic change to the TS side must regenerate the file
  // (bun scripts/generate-flow-vectors.ts) AND keep the C++ side green —
  // this test catches the half-done state.
  test('committed vectors match the TS reference implementation', () => {
    // JSON round-trip applies the same undefined-dropping normalization the
    // generator's serialization does.
    expect(JSON.parse(JSON.stringify(buildVectors()))).toEqual(
      vectorsFile.cases
    );
  });
});
