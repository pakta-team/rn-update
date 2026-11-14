import argparse
import hashlib
import json
import pathlib
import subprocess
import tarfile
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument('har', type=pathlib.Path)
parser.add_argument('--llvm-bin', type=pathlib.Path, required=True)
args = parser.parse_args()
suffix = '.exe' if (args.llvm_bin / 'llvm-readelf.exe').exists() else ''
exports = [
    'stepRound', 'runnableConfig', 'hostCancellation', 'normalizeConfiguration',
    'installBuildRecord', 'installParseRecord', 'installReadRecord',
    'installWriteRecord', 'installSeal', 'installPromote', 'installIsComplete',
    'installCheckActivation', 'installActivationUnchanged',
    'installIsReservedEntry', 'installCheckUncompressedSize',
    'installAuditExtractedDirectory', 'installParseManifest',
]
result = {'har': str(args.har), 'sha256': hashlib.sha256(args.har.read_bytes()).hexdigest(), 'abis': []}
with tarfile.open(args.har) as archive, tempfile.TemporaryDirectory() as directory:
    for abi, machine in [('arm64-v8a', 'AArch64'), ('x86_64', 'Advanced Micro Devices X86-64')]:
        member = archive.getmember(f'package/libs/{abi}/librnupdate.so')
        data = archive.extractfile(member).read()
        for name in exports:
            if name.encode() + b'\0' not in data:
                raise RuntimeError(f'{abi}: missing NAPI registration {name}')
        for name in ['buildCheckRequestBody', 'orderEndpointCandidates',
                     'isValidCheckResponse', 'handleCheckResponse']:
            if name.encode() + b'\0' in data:
                raise RuntimeError(f'{abi}: retired NAPI registration {name}')
        binary = pathlib.Path(directory) / f'{abi}.so'
        binary.write_bytes(data)
        header = subprocess.check_output([str(args.llvm_bin / f'llvm-readelf{suffix}'), '-h', str(binary)], text=True)
        if machine not in header:
            raise RuntimeError(f'{abi}: wrong ELF machine')
        undefined = subprocess.check_output([str(args.llvm_bin / f'llvm-nm{suffix}'), '--dynamic', '--undefined-only', '--demangle', str(binary)], text=True)
        if any(name in undefined for name in ['pakta::', 'flowjson::', 'updateflow::', 'harmony_install::', 'harmony_round::']):
            raise RuntimeError(f'{abi}: unresolved internal reference\n{undefined}')
        result['abis'].append({'abi': abi, 'sha256': hashlib.sha256(data).hexdigest(), 'registrations': len(exports), 'internalUndefined': 0})
    text = archive.extractfile('package/src/main/ets/NativeCheckOrchestrator.ts').read().decode()
    executor = archive.extractfile('package/src/main/ets/HarmonyRound.ts').read().decode()
    if 'runHarmonyRound' not in text or 'host.step(state, JSON.stringify(event))' not in executor:
        raise RuntimeError('HAR does not contain the new runtime')
print(json.dumps(result, indent=2))
