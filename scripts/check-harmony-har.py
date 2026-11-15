#!/usr/bin/env python3
# [INPUT]: 依赖 Python3.8+ 标准库、HAR tar、当前 Harmony ETS 源码、预期版本与双 ABI ELF 字节
# [OUTPUT]: 拒绝旧源码、错误版本/ABI、缺失安装/轮次/resume 注册的新输入候选
# [POS]: scripts 的 HAR 发布输入闸门，不替代 LLVM 链接检查或设备 NAPI 验证
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import subprocess
import tarfile
import tempfile


ROOT = Path(__file__).resolve().parents[1]
REGISTRATIONS = (
    'stepRound', 'runnableConfig', 'hostCancellation', 'normalizeConfiguration',
    'installBuildRecord', 'installParseRecord', 'installReadRecord',
    'installWriteRecord', 'installSeal', 'installPromote', 'installIsComplete',
    'installCheckActivation', 'installActivationUnchanged',
    'installIsReservedEntry', 'installCheckUncompressedSize',
    'installAuditExtractedDirectory', 'installParseManifest',
    'resumeParseContentRange', 'resumePlanRequest', 'resumeClassifyResponse',
    'resumeSidecar',
)


def check_har(har, version, source_root=ROOT):
    with tarfile.open(har) as archive:
        members = archive.getmembers()
        names = [member.name for member in members]
        if len(names) != len(set(names)):
            raise ValueError('duplicate HAR entries')
        for member in members:
            if (not member.name.startswith('package/') or
                    '..' in member.name.split('/') or '\\' in member.name or
                    not (member.isfile() or member.isdir())):
                raise ValueError(f'unsafe HAR entry: {member.name}')

        def read(name):
            member = archive.getmember('package/' + name)
            if not member.isfile() or member.size > 64 * 1024 * 1024:
                raise ValueError(f'invalid HAR file: {name}')
            return archive.extractfile(member).read()

        metadata = read('oh-package.json5').decode('utf-8')
        match = re.search(r'''(?:["']version["']|\bversion)\s*:\s*["']([^"']+)["']''', metadata)
        if not match or match[1] != version:
            raise ValueError('HAR version mismatch')
        if 'package/BuildProfile.ets' not in names:
            raise ValueError('missing HAR BuildProfile.ets')
        profile = read('BuildProfile.ets').decode('utf-8')
        profile = re.sub(r'/\*[\s\S]*?\*/|//[^\r\n]*', '', profile)
        for field, expected in [('HAR_VERSION', version), ('BUILD_MODE_NAME', 'release'), ('DEBUG', False)]:
            declarations = re.findall(
                rf'^\s*export\s+const\s+{field}\s*(?::\s*(?:string|boolean))?\s*=\s*([^;\r\n]+)\s*;?\s*$',
                profile, re.MULTILINE)
            if len(declarations) != 1:
                raise ValueError(f'HAR BuildProfile {field}: expected one declaration')
            value = declarations[0].strip()
            if field == 'DEBUG':
                valid = value == 'false'
            else:
                literal = re.fullmatch(r'''(["'])([^"']*)\1''', value)
                valid = literal is not None and literal[2] == expected
            if not valid:
                raise ValueError(f'HAR BuildProfile {field} mismatch: expected {expected}')
        source = source_root / 'harmony/pakta/src/main/ets'
        if not source.is_dir():
            raise ValueError('missing HAR source input directory')
        expected_sources = {
            'package/src/main/ets/' + file.relative_to(source).as_posix()
            for file in source.rglob('*') if file.suffix in ('.ts', '.ets')
        }
        actual_sources = {
            name for name in names if name.startswith('package/src/main/ets/')
            and Path(name).suffix in ('.ts', '.ets')
        }
        if not expected_sources or actual_sources != expected_sources:
            raise ValueError('HAR source inventory mismatch')
        for file in sorted(source.rglob('*')):
            if file.suffix not in ('.ts', '.ets'):
                continue
            name = 'src/main/ets/' + file.relative_to(source).as_posix()
            if read(name) != file.read_bytes():
                raise ValueError(f'HAR source mismatch: {name}')
        abis = []
        for abi, machine in [('arm64-v8a', 183), ('x86_64', 62)]:
            data = read(f'libs/{abi}/librnupdate.so')
            if (len(data) < 64 or data[:6] != b'\x7fELF\x02\x01' or
                    struct.unpack_from('<H', data, 18)[0] != machine or
                    struct.unpack_from('<H', data, 16)[0] != 3):
                raise ValueError(f'{abi}: wrong ELF ABI')
            for name in REGISTRATIONS:
                if name.encode() + b'\0' not in data:
                    raise ValueError(f'{abi}: missing NAPI registration {name}')
            abis.append({'abi': abi, 'sha256': hashlib.sha256(data).hexdigest(),
                         'registrations': len(REGISTRATIONS)})
        libraries = sorted(member.name for member in members
                           if member.isfile() and member.name.endswith('.so'))
        with tempfile.TemporaryDirectory(prefix='pakta binary strings ') as directory:
            files = []
            for index, name in enumerate(libraries):
                file = Path(directory) / f'{index} {Path(name).name}'
                file.write_bytes(read(name[len('package/'):]))
                files.append(str(file))
            try:
                result = subprocess.run(
                    ['node', str(Path(__file__).with_name('check-binary-strings.js')), *files],
                    capture_output=True, text=True, encoding='utf-8', errors='replace',
                    timeout=120, check=False)
            except (OSError, subprocess.TimeoutExpired) as error:
                raise ValueError(f'HAR binary strings check unavailable: {error}') from error
            if result.returncode:
                details = result.stderr + result.stdout
                for file, name in zip(files, libraries):
                    details = details.replace(file, name)
                raise ValueError(f'HAR binary strings check failed: {details.strip()}')
    return {'sha256': hashlib.sha256(har.read_bytes()).hexdigest(),
            'version': version, 'buildMode': 'release', 'debug': False,
            'sources': len(expected_sources), 'abis': abis,
            'binaryStringsChecked': len(libraries)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('har', type=Path)
    parser.add_argument('--version', default=json.loads((ROOT / 'package.json').read_text())['version'])
    args = parser.parse_args()
    print(json.dumps(check_har(args.har, args.version), indent=2))
