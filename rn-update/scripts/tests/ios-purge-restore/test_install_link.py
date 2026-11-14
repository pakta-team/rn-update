import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[3]


class InstallLinkTests(unittest.TestCase):
    def test_unzip_guard_platform_parameter(self):
        record = (ROOT / 'ios/RCTPakta/RCTPaktaInstallRecord.inc').read_text(encoding='utf-8')
        files = (ROOT / 'ios/RCTPakta/RCTPaktaInstallerFiles.inc').read_text(encoding='utf-8')

        def wired(record, files):
            return (record.count('- (instancetype)initWithArchiveBytes:(long long)archiveBytes') == 2
                    and record.count('_entries = pakta::archive_limits::EntryAccumulator(archiveBytes);') == 1
                    and files.count('[[PaktaUnzipGuard alloc] initWithArchiveBytes:archiveBytes]') == 1)

        self.assertTrue(wired(record, files), 'guard must receive the real archiveBytes')
        for old, new, target in (
            ('initWithArchiveBytes:archiveBytes]', 'initWithArchiveBytes:0]', 'files'),
            ('[[PaktaUnzipGuard alloc] initWithArchiveBytes:archiveBytes]', '[PaktaUnzipGuard new]', 'files'),
            ('EntryAccumulator(archiveBytes);', 'EntryAccumulator(0);', 'record'),
        ):
            with self.subTest(mutation=new):
                source = files if target == 'files' else record
                self.assertEqual(source.count(old), 1)
                mutant = source.replace(old, new)
                self.assertFalse(wired(mutant if target == 'record' else record,
                                       mutant if target == 'files' else files))

    def test_production_unzip_guard_archive_bytes(self):
        record = (ROOT / 'ios/RCTPakta/RCTPaktaInstallRecord.inc').read_text(encoding='utf-8')
        files = (ROOT / 'ios/RCTPakta/RCTPaktaInstallerFiles.inc').read_text(encoding='utf-8')
        member, = re.findall(r'pakta::archive_limits::EntryAccumulator _entries\{([^}]+)\};', record)
        accept, = re.findall(r'auto status = _entries.Accept\(([\s\S]*?)\);', record)
        call, = re.findall(r'PaktaUnzipGuard \*guard = ([^;]+);', files)
        self.assertIn('long long archiveBytes = RCTPaktaFileSize(path);', files)
        self.assertIn('PaktaToStdString(destination), archiveBytes);', files)
        initializers = re.findall(r'_entries = pakta::archive_limits::EntryAccumulator\(([^)]+)\);', record)
        if call == '[PaktaUnzipGuard new]':
            construct = 'Guard guard;'
        else:
            argument, = re.findall(r'\[\[PaktaUnzipGuard alloc\] initWithArchiveBytes:(\w+)\]', call)
            self.assertEqual(len(initializers), 1)
            construct = f'Guard guard; guard.initialize({argument});'
        initialize = f'void initialize(long long archiveBytes) {{ (void)archiveBytes; _entries = pakta::archive_limits::EntryAccumulator({initializers[0]}); }}' if initializers else ''
        code = f'''#include "archive_limits.h"
#include <iostream>
#include <sys/stat.h>
struct Info {{ long long uncompressed_size, compressed_size; unsigned external_fa; }};
struct Guard {{
  pakta::archive_limits::EntryAccumulator _entries{{{member}}};
  {initialize}
  bool accept(Info fileInfo) {{ auto status = _entries.Accept({accept}); return status.ok; }}
}};
bool run(long long archiveBytes, Info first, Info second = {{0, 0, 0}}) {{
  (void)archiveBytes;
  {construct}
  return guard.accept(first) && guard.accept(second);
}}
int main() {{
  int failures = 0;
  auto check = [&](bool ok, const char* name) {{
    std::cout << (ok ? "PASS " : "FAIL ") << name << '\\n';
    failures += !ok;
  }};
  check(run(1048576, {{1048577, 524289, 0}}), "normal entry above 1 MiB");
  check(run(2097152, {{3145728, 1572864, 0}}), "normal archive above 1 MiB");
  check(run(1048576, {{600000, 300000, 0}}, {{600000, 300000, 0}}), "cumulative above 1 MiB");
  check(run(1048576, {{1048576, 524288, 0}}), "exactly 1 MiB");
  check(run(20000, {{2000000, 20000, 0}}), "exactly total ratio limit");
  check(!run(20000, {{1000000, 500000, 0}}, {{1000001, 500001, 0}}), "total ratio still rejected");
  check(!run(1048576, {{1048577, 1, 0}}), "entry ratio still rejected");
  check(!run(1048576, {{1, 1, static_cast<unsigned>(S_IFLNK) << 16}}), "symlink still rejected");
  check(!run(1048576, {{536870913, 536870913, 0}}), "entry size still rejected");
  check(!run(0, {{1048577, 524289, 0}}), "zero archive still rejected");
  return failures ? 1 : 0;
}}
'''
        with tempfile.TemporaryDirectory(prefix='pakta-apple-guard-') as directory:
            build = Path(directory)
            (build / 'guard.cpp').write_text(code, encoding='utf-8')
            def native(path):
                if os.name == 'nt':
                    return subprocess.check_output(['wsl', '--exec', 'wslpath', '-a', str(path)], text=True).strip()
                return str(path)
            prefix = ['wsl', '--exec'] if os.name == 'nt' else []
            command = [*prefix, 'g++', '-std=c++17', '-Wall', '-Wextra', '-Werror',
                       '-I' + native(ROOT / 'cpp/patch_core'),
                       native(build / 'guard.cpp'), native(ROOT / 'cpp/patch_core/archive_limits.cpp'),
                       '-o', native(build / 'guard')]
            command[command.index('-o'):command.index('-o')] = [
                '-ffunction-sections', '-fdata-sections', '-Wl,--gc-sections',
                '-I' + native(ROOT / 'android/jni'),
                '-I' + native(ROOT / 'android/jni/HDiffPatch/libHDiffPatch/HPatch'),
                native(ROOT / 'cpp/patch_core/patch_core.cpp')]
            compiled = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(compiled.returncode, 0, compiled.stdout + compiled.stderr)
            result = subprocess.run([*prefix, native(build / 'guard')], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            for name, mutant in (
                ('zero-member', code.replace(f'_entries{{{member}}}', '_entries{0}').replace(
                    'EntryAccumulator(archiveBytes)', 'EntryAccumulator(0)')),
                ('zero-platform-argument', code.replace('guard.initialize(archiveBytes)', 'guard.initialize(0)')),
            ):
                with self.subTest(mutation=name):
                    self.assertNotEqual(mutant, code)
                    (build / 'guard.cpp').write_text(mutant, encoding='utf-8')
                    compiled = subprocess.run(command, capture_output=True, text=True)
                    self.assertEqual(compiled.returncode, 0, compiled.stdout + compiled.stderr)
                    result = subprocess.run([*prefix, native(build / 'guard')], capture_output=True, text=True)
                    self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
                    self.assertIn('FAIL normal entry above 1 MiB', result.stdout)
                    self.assertIn('FAIL cumulative above 1 MiB', result.stdout)

    def test_podspec_cpp_source_closure(self):
        podspec = (ROOT / 'rn-update.podspec').read_text(encoding='utf-8')
        patterns = re.findall(r"'(cpp/[^']+)\.\{h,cpp\}'", podspec)
        sources = [ROOT / (name + '.cpp') for name in patterns]
        self.assertEqual(len(sources), len(set(sources)))
        for name in ('install_record', 'archive_limits', 'patch_manifest'):
            self.assertIn(ROOT / f'cpp/patch_core/{name}.cpp', sources)
        with tempfile.TemporaryDirectory(prefix='pakta-apple-install-') as directory:
            build = Path(directory)
            def native(path):
                if os.name == 'nt':
                    return subprocess.check_output(['wsl', '--exec', 'wslpath', '-a', str(path)], text=True).strip()
                return str(path)
            prefix = ['wsl', '--exec'] if os.name == 'nt' else []
            root = native(ROOT)
            destination = native(build)
            subprocess.run([*prefix, 'env', f'BUILD_DIR={destination}', 'sh',
                            f'{root}/scripts/test-install-core.sh'], check=True, capture_output=True)
            includes = ['cpp/patch_core', 'cpp', 'android/jni', 'android/jni/HDiffPatch',
                        'android/jni/HDiffPatch/libHDiffPatch/HPatch', 'android/jni/lzma/C']
            command = [*prefix, 'g++', '-std=c++17', '-Wall', '-Wextra', '-Werror',
                       *['-I' + root + '/' + value for value in includes],
                       f'{root}/cpp/patch_core/tests/install_core_test.cpp',
                       *map(native, sources), *map(native, build.glob('*.o')),
                       '-o', destination + '/pod-install']
            subprocess.run(command, check=True, capture_output=True)
            subprocess.run([*prefix, destination + '/pod-install',
                            root + '/cpp/patch_core/tests'], check=True)
            for name in ('install_record', 'archive_limits', 'patch_manifest'):
                missing = native(ROOT / f'cpp/patch_core/{name}.cpp')
                result = subprocess.run([arg for arg in command if arg != missing], capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('undefined reference', result.stderr)


if __name__ == '__main__':
    unittest.main()
