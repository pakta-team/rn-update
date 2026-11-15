# [INPUT]: 依赖 Apple 生产翻译单元/内部片段、拆分前摘要与现有 Podspec，只读提取守卫/启动方法
# [OUTPUT]: 验证唯一共享执行器、未改方法摘要、片段单所有者与800行/发布边界
# [POS]: ios-purge-restore 的职责拆分回归，不修改 Podspec、不证明 Apple 工具链构建
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import hashlib
import json
from pathlib import Path
import re
import unittest

from extract import function, method


ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / 'ios/RCTPakta/RCTPakta.mm'
BASELINE = Path(__file__).with_name('apple-characterization.json')


def production_source(path=SOURCE):
    text = path.read_text(encoding='utf-8')
    return re.sub(
        r'^#include "(RCTPakta[^"/]+\.inc)"\n',
        lambda match: production_source(path.parent / match[1]),
        text,
        flags=re.MULTILINE,
    )


class AppleSplitTests(unittest.TestCase):
    def test_shared_round_is_the_only_executor(self):
        source = production_source()
        self.assertEqual(source.count('pakta::updateflow::StepRound(state, event)'), 1)
        for removed in ('runConfiguredRound:', 'runCheckRequest:', 'performAttempts:'):
            self.assertNotIn(removed, source)

    def test_guard_and_launch_bodies_are_unchanged(self):
        source = production_source()
        expected = json.loads(BASELINE.read_text(encoding='utf-8'))
        for name, digest in expected['functions'].items():
            if name in ('PaktaReadInstallRecord', 'PaktaVerifyInstallForActivation'):
                continue
            with self.subTest(function=name):
                self.assertEqual(hashlib.sha256(function(source, name)[1].encode()).hexdigest(), digest)
        for name, digest in expected['methods'].items():
            if name in ('runOnce', 'runCheckRequest', 'performAttempts', 'commitRoundWithGeneration',
                        'restorePurgedLaunch'):
                continue
            with self.subTest(method=name):
                self.assertEqual(hashlib.sha256(method(source, name)[1].encode()).hexdigest(), digest)

    def test_internal_sources_are_single_owner_and_not_public(self):
        source = SOURCE.read_text(encoding='utf-8')
        includes = re.findall(r'^#include "(RCTPakta[^"/]+\.inc)"$', source, re.MULTILINE)
        files = list(SOURCE.parent.glob('RCTPakta*.inc'))
        self.assertEqual(len(includes), len(set(includes)))
        self.assertEqual(set(includes), {path.name for path in files})
        for path in [SOURCE, *files]:
            self.assertLessEqual(len(path.read_text(encoding='utf-8').splitlines()), 800)
        podspec = (ROOT / 'rn-update.podspec').read_text(encoding='utf-8')
        self.assertNotRegex(podspec, r'source_files[^\n]*\{[^}]*inc')
        self.assertIn("ss.preserve_paths = 'ios/RCTPakta/*.inc'", podspec)
        for name in ('native_config', 'native_round', 'round_engine'):
            self.assertIn(f'cpp/update_flow_core/{name}.{{h,cpp}}', podspec)
        for name in ('install_record', 'archive_limits', 'patch_manifest'):
            self.assertIn(f'cpp/patch_core/{name}.{{h,cpp}}', podspec)


if __name__ == '__main__':
    unittest.main()
