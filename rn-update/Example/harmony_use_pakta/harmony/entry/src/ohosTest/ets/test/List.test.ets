/**
 * [INPUT]: 依赖 Ability.test 与 PaktaIntegration.test 的 Hypium 测试注册函数。
 * [OUTPUT]: 导出 testsuite，按顺序组合 Harmony 设备端测试。
 * [POS]: ohosTest 的单一套件入口，供 HAP 测试 runner 发现。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import abilityTest from './Ability.test';
import paktaIntegrationTest from './PaktaIntegration.test';

export default function testsuite() {
  abilityTest();
  paktaIntegrationTest();
}
