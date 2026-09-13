/**
 * [INPUT]: 依赖 LocalUnit.test.ets 导出的 localUnitTest。
 * [OUTPUT]: 导出 testsuite，注册 Harmony 本地单元测试集合。
 * [POS]: 本地测试套装配入口，被 Hvigor/Hypium 测试任务发现。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import localUnitTest from './LocalUnit.test';

export default function testsuite() {
  localUnitTest();
}
