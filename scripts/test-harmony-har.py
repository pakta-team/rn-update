#!/usr/bin/env python3
# [INPUT]: 依赖 HAR 闸门、临时 tar 与合成 ELF/源码夹具
# [OUTPUT]: 验证版本、源码、ABI、注册缺失和路径/重复条目负控均被拒绝
# [POS]: scripts 的输入闸门单测，不将合成 ELF 当成真实链接证据
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import argparse
import importlib.util
import io
import json
from pathlib import Path
import re
import struct
import tarfile
import tempfile
import unittest


spec = importlib.util.spec_from_file_location('har_guard', Path(__file__).with_name('check-harmony-har.py'))
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)
REAL_HAR = None


class HarTests(unittest.TestCase):
    def fixture(self, directory, mutation=None):
        root = Path(directory)
        source = root / 'harmony/pakta/src/main/ets'
        source.mkdir(parents=True)
        (source / 'HarmonyRound.ts').write_bytes(b'current source')
        entries = {
            'package/oh-package.json5': b'{version: "1.1.0"}',
            'package/BuildProfile.ets': (
                b"export const HAR_VERSION = '1.1.0';\n"
                b"export const BUILD_MODE_NAME = 'release';\n"
                b'export const DEBUG = false;\n'),
            'package/src/main/ets/HarmonyRound.ts': b'current source',
        }
        for abi, machine in [('arm64-v8a', 183), ('x86_64', 62)]:
            data = bytearray(64)
            data[:6] = b'\x7fELF\x02\x01'
            struct.pack_into('<HH', data, 16, 3, machine)
            entries[f'package/libs/{abi}/librnupdate.so'] = bytes(data) + b'\0'.join(
                name.encode() for name in guard.REGISTRATIONS) + b'\0'
        if mutation:
            mutation(entries)
        har = root / 'candidate.har'
        with tarfile.open(har, 'w:gz') as archive:
            for name, data in entries.items():
                member = tarfile.TarInfo(name)
                member.size = len(data)
                archive.addfile(member, io.BytesIO(data))
        return har, root

    def test_positive(self):
        with tempfile.TemporaryDirectory() as directory:
            har, root = self.fixture(directory)
            self.assertEqual(len(guard.check_har(har, '1.1.0', root)['abis']), 2)

    def test_mismatches_fail(self):
        cases = [
            ('version', lambda e: e.update({'package/oh-package.json5': b'{version:"0.0.1"}'})),
            ('source', lambda e: e.update({'package/src/main/ets/HarmonyRound.ts': b'old source'})),
            ('ABI', lambda e: e.update({'package/libs/x86_64/librnupdate.so': b'old binary'})),
            ('registration', lambda e: e.update({'package/libs/arm64-v8a/librnupdate.so':
                e['package/libs/arm64-v8a/librnupdate.so'].replace(b'resumeSidecar', b'oldSidecar')})),
            ('registration', lambda e: e.update({'package/libs/x86_64/librnupdate.so':
                e['package/libs/x86_64/librnupdate.so'].replace(b'normalizeConfiguration', b'oldConfiguration')})),
            ('unsafe', lambda e: e.update({'package/../escape': b'bad'})),
            ('source inventory', lambda e: e.update({'package/src/main/ets/OldRound.ts': b'old'})),
        ]
        for message, mutation in cases:
            with self.subTest(message=message), tempfile.TemporaryDirectory() as directory:
                har, root = self.fixture(directory, mutation)
                with self.assertRaisesRegex(ValueError, message):
                    guard.check_har(har, '1.1.0', root)

    def test_duplicate_entry_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            har, root = self.fixture(directory)
            duplicate = root / 'duplicate.har'
            with tarfile.open(har) as original, tarfile.open(duplicate, 'w') as archive:
                for member in original.getmembers():
                    archive.addfile(member, original.extractfile(member))
                data = b'{version:"1.1.0"}'
                member = tarfile.TarInfo('package/oh-package.json5')
                member.size = len(data)
                archive.addfile(member, io.BytesIO(data))
            with self.assertRaisesRegex(ValueError, 'duplicate'):
                guard.check_har(duplicate, '1.1.0', root)

    def test_build_profile_mismatches_fail(self):
        cases = [
            ('DEBUG', lambda p: p.replace(b'DEBUG = false', b'DEBUG = true')),
            ('HAR_VERSION', lambda p: p.replace(b"'1.1.0'", b"'0.0.1'")),
            ('BUILD_MODE_NAME', lambda p: p.replace(b"'release'", b"'debug'")),
            ('DEBUG', lambda p: p.replace(b'export const DEBUG = false;', b'// export const DEBUG = false;')),
            ('DEBUG', lambda p: p + b'export const DEBUG = false;\n'),
            ('DEBUG', lambda p: p.replace(b'false', b'Boolean(0)')),
        ]
        for message, mutate in cases:
            with self.subTest(field=message), tempfile.TemporaryDirectory() as directory:
                har, root = self.fixture(directory, lambda e: e.update({
                    'package/BuildProfile.ets': mutate(e['package/BuildProfile.ets'])}))
                with self.assertRaisesRegex(ValueError, 'BuildProfile ' + message):
                    guard.check_har(har, '1.1.0', root)
        with tempfile.TemporaryDirectory() as directory:
            har, root = self.fixture(directory, lambda e: e.pop('package/BuildProfile.ets'))
            with self.assertRaisesRegex(ValueError, 'missing HAR BuildProfile'):
                guard.check_har(har, '1.1.0', root)

    def test_real_har_build_profile_negative_controls(self):
        if REAL_HAR is None:
            self.skipTest('pass --har to validate a real Release HAR')
        version = json.loads((guard.ROOT / 'package.json').read_text())['version']
        guard.check_har(REAL_HAR, version)
        cases = [('DEBUG', b'true'), ('HAR_VERSION', b"'0.0.0-negative-control'"),
                 ('BUILD_MODE_NAME', b"'debug'")]
        original_digest = guard.hashlib.sha256(REAL_HAR.read_bytes()).hexdigest()
        for field, value in cases:
            with self.subTest(field=field), tempfile.TemporaryDirectory() as directory:
                candidate = Path(directory) / 'mutated.har'
                with tarfile.open(REAL_HAR) as original, tarfile.open(candidate, 'w:gz') as archive:
                    for member in original.getmembers():
                        data = original.extractfile(member).read() if member.isfile() else None
                        if member.name == 'package/BuildProfile.ets':
                            data, count = re.subn(
                                rb'(?m)^(export const ' + field.encode() + rb'\s*=\s*)[^;\r\n]+',
                                lambda match: match[1] + value, data)
                            self.assertEqual(count, 1)
                            member.size = len(data)
                        archive.addfile(member, io.BytesIO(data) if data is not None else None)
                with self.assertRaisesRegex(ValueError, 'BuildProfile ' + field + ' mismatch'):
                    guard.check_har(candidate, version)
        self.assertEqual(guard.hashlib.sha256(REAL_HAR.read_bytes()).hexdigest(), original_digest)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--har', type=Path)
    args, remaining = parser.parse_known_args()
    REAL_HAR = args.har
    unittest.main(argv=[__file__, *remaining])
