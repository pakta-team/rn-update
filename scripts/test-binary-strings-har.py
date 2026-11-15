# [INPUT]: 依赖 unittest、test-harmony-har 夹具与 HAR checker/Node 禁串入口，显式读取 --har
# [OUTPUT]: 对外提供全部库扫描、路径、额外库、缺 Node 与真实双 ABI 缺库/禁串负控
# [POS]: scripts 的 HAR 禁串专项，临时构造突变而不修改输入 HAR，不证明原生链接或设备行为
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import argparse
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest import mock


spec = importlib.util.spec_from_file_location(
    'har_tests', Path(__file__).with_name('test-harmony-har.py'))
har_tests = importlib.util.module_from_spec(spec)
spec.loader.exec_module(har_tests)
guard = har_tests.guard
REAL_HAR = None


def mutate_har(source, target, name, payload):
    with tarfile.open(source) as original, tarfile.open(target, 'w:gz') as archive:
        for original_member in original.getmembers():
            member = copy.copy(original_member)
            if member.name == name and payload is None:
                continue
            data = original.extractfile(member).read() if member.isfile() else None
            if member.name == name:
                data = data + payload
                member.size = len(data)
            archive.addfile(member, io.BytesIO(data) if data is not None else None)


class BinaryStringsHarTests(unittest.TestCase):
    def test_all_libraries_and_argument_array(self):
        with tempfile.TemporaryDirectory(prefix='pakta HAR tests ') as directory:
            har, root = har_tests.HarTests().fixture(directory, lambda entries: entries.update({
                'package/libs/arm64-v8a/libc++_shared.so': b'Pakta update patch rescue reload hotfix',
                'package/libs/x86_64/lib extra.so': b'RCTPakta',
            }))
            run = guard.subprocess.run
            with mock.patch.object(guard.subprocess, 'run', wraps=run) as invoked:
                result = guard.check_har(har, '1.1.0', root)
            self.assertEqual(result['binaryStringsChecked'], 4)
            command = invoked.call_args.args[0]
            self.assertIsInstance(command, list)
            self.assertEqual(len(command), 6)
            self.assertTrue(all(Path(file).name.find(' ') >= 0 for file in command[2:]))
            self.assertNotIn('shell', invoked.call_args.kwargs)

    def test_extra_library_empty_and_forbidden_fail(self):
        for payload, message in [(b'', 'empty binary'), (b'Pakta Pushy', 'forbidden wording'),
                                 (b'REACT-NATIVE-UPDATE', 'forbidden wording')]:
            with self.subTest(payload=payload), tempfile.TemporaryDirectory() as directory:
                har, root = har_tests.HarTests().fixture(directory, lambda entries: entries.update({
                    'package/libs/x86_64/lib extra.so': payload}))
                with self.assertRaisesRegex(ValueError, message):
                    guard.check_har(har, '1.1.0', root)

    def test_node_unavailable_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            har, root = har_tests.HarTests().fixture(directory)
            with mock.patch.object(guard.subprocess, 'run', side_effect=FileNotFoundError('node')):
                with self.assertRaisesRegex(ValueError, 'binary strings check unavailable'):
                    guard.check_har(har, '1.1.0', root)

    def test_real_har_and_each_library_negative_controls(self):
        self.assertIsNotNone(REAL_HAR, '必须通过 --har 指定真实 Release HAR')
        before = hashlib.sha256(REAL_HAR.read_bytes()).hexdigest()
        version = json.loads((guard.ROOT / 'package.json').read_text())['version']
        result = guard.check_har(REAL_HAR, version)
        with tarfile.open(REAL_HAR) as archive:
            libraries = [member.name for member in archive.getmembers()
                         if member.isfile() and member.name.endswith('.so')]
        self.assertEqual(len(libraries), 4)
        self.assertEqual(result['binaryStringsChecked'], len(libraries))
        for name in libraries:
            for payload in [b'\0Pushy\0', b'\0REACT-NATIVE-UPDATE\0']:
                with self.subTest(library=name, payload=payload), tempfile.TemporaryDirectory(
                        prefix='pakta real HAR ') as directory:
                    candidate = Path(directory) / 'dirty candidate.har'
                    mutate_har(REAL_HAR, candidate, name, payload)
                    with self.assertRaisesRegex(ValueError, 'forbidden wording') as raised:
                        guard.check_har(candidate, version)
                    self.assertIn(name, str(raised.exception))
        for abi in ['arm64-v8a', 'x86_64']:
            with self.subTest(missing=abi), tempfile.TemporaryDirectory() as directory:
                candidate = Path(directory) / 'missing.har'
                mutate_har(REAL_HAR, candidate, f'package/libs/{abi}/librnupdate.so', None)
                with self.assertRaises(KeyError):
                    guard.check_har(candidate, version)
        self.assertEqual(hashlib.sha256(REAL_HAR.read_bytes()).hexdigest(), before)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--har', type=Path, required=True)
    args, remaining = parser.parse_known_args()
    REAL_HAR = args.har
    unittest.main(argv=[__file__, *remaining])
