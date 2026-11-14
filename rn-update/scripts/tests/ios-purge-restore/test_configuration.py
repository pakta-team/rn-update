import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from extract import method, production_source

ROOT = Path(__file__).resolve().parents[3]


def native_path(path):
    text = str(path).replace('\\', '/')
    return '/mnt/' + text[0].lower() + text[2:] if os.name == 'nt' else text


def run(command, **kwargs):
    return subprocess.run((['wsl', '-d', 'Ubuntu', '--'] if os.name == 'nt' else []) + command,
                          text=True, capture_output=True, **kwargs)


class ConfigurationTests(unittest.TestCase):
    def test_extracted_apple_shared_expressions_and_mutations(self):
        source = production_source(ROOT / 'ios/RCTPakta/RCTPakta.mm')
        gate = method(source, 'hasRunnableConfig')[1]
        equivalent = method(source, 'isJsCheckCompleted')[1]
        host = method(source, 'checkAndUpdate')[1]
        persist = method(source, 'persistConfiguration')[1]
        self.assertIn('pakta::updateflow::ConfigsEquivalent(', persist)
        self.assertIn('pakta::updateflow::ParseRunnableConfig(', host)
        gate = gate[gate.index('    return '):].split(';')[0].replace('PaktaToStdString(json)', 'json') + ';'
        equivalent = equivalent[equivalent.rindex('    return '):].split(';')[0]
        equivalent = equivalent.replace('PaktaToStdString(persisted)', 'persisted').replace('PaktaToStdString(jsConfig)', 'jsConfig') + ';'
        cancel = host[host.index('    const std::string cancelled'):host.index('    if (!cancelled.empty())')]
        for old, new in {
            'PaktaToStdString(configJson)': 'config',
            'PaktaToStdString(paktaHostRoundConfig)': 'round',
            'PaktaToStdString([PaktaDefaults() stringForKey:keyNativeConfig])': 'stored',
            'paktaHostRoundConfigGeneration': 'cg', 'paktaNativeConfigGeneration.load()': 'currentCg',
            'paktaHostRoundGeneration': 'rg', 'paktaResetGeneration.load()': 'currentRg',
        }.items():
            cancel = cancel.replace(old, new)
        template = r'''
#include <cassert>
#include "cpp/update_flow_core/native_config.h"
#include "cpp/update_flow_core/round_engine.h"
bool Gate(const std::string& json) { GATE }
bool Equivalent(const std::string& persisted, const std::string& jsConfig) { EQUIVALENT }
std::string Cancel(std::string config, std::string round, std::string stored,
                   double cg, double currentCg, double rg, double currentRg) {
  CANCEL return cancelled;
}
int main() {
  assert(!Gate("")); assert(!Gate("[]")); assert(!Gate("{\"appKey\":\" \"}"));
  assert(!Gate("{\"appKey\":\"a\",\"disabled\":\"false\"}"));
  assert(Gate("{\"appKey\":\" a \"}"));
  std::string a = "{\"appKey\":\"a\",\"endpoints\":[\"https://a/\"]}";
  std::string b = "{\"endpoints\":[\"https://a\"],\"appKey\":\"a\",\"disabled\":false}";
  assert(Equivalent(a,b)); assert(!Equivalent("", ""));
  assert(Cancel(a,b,a,1,1,2,2).empty());
  assert(Cancel(a,b,a,1,3,2,4) == "config_changed");
  assert(Cancel(a,b,a,1,1,2,4) == "reset");
}
'''
        core = [str(ROOT / 'cpp/update_flow_core' / name) for name in
                ('flow_json.cpp', 'update_flow_core.cpp', 'native_config.cpp', 'native_round.cpp', 'round_engine.cpp')]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            for name, g, e, c in (
                ('positive', gate, equivalent, cancel),
                ('gate', 'return true;', equivalent, cancel),
                ('equivalent', gate, 'return false;', cancel),
                ('cancel', gate, equivalent, 'const std::string cancelled;'),
            ):
                cpp = path / (name + '.cpp')
                cpp.write_text(template.replace('GATE', g).replace('EQUIVALENT', e).replace('CANCEL', c), encoding='utf-8')
                binary = native_path(path / name)
                build = run(['c++', '-std=c++17', '-I' + native_path(ROOT), native_path(cpp),
                             *[native_path(item) for item in core], '-o', binary])
                self.assertEqual(build.returncode, 0, build.stderr)
                result = run([binary])
                if name == 'positive':
                    self.assertEqual(result.returncode, 0, result.stderr)
                else:
                    self.assertNotEqual(result.returncode, 0, name)

    def test_real_jni_configuration_and_exception_protocol(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            java = path / 'cn/reactnative/modules/update'
            java.mkdir(parents=True)
            (java / 'NativeUpdateCore.java').write_text(
                'package cn.reactnative.modules.update; class NativeUpdateCore {'
                'static void ensureLoaded() { System.load(System.getProperty("library")); }}', encoding='utf-8')
            (java / 'ConfigTest.java').write_text(r'''
package cn.reactnative.modules.update;
class ConfigTest {
  public static void main(String[] args) {
    String result = NativeUpdateFlow.normalizeConfiguration("{\"appKey\":\"应用😀\"}");
    if (!result.contains("应用😀") || result.contains("channel")) throw new AssertionError(result);
    for (String input : new String[] {"{\"appKey\":\"a\",\"channel\":null}", "{}"}) {
      try { NativeUpdateFlow.normalizeConfiguration(input); throw new AssertionError("accepted"); }
      catch (IllegalArgumentException error) {
        if (!error.getMessage().startsWith("Invalid native configuration: ")) throw error;
      }
    }
  }
}
''', encoding='utf-8')
            home = run(['readlink', '-f', '/usr/bin/javac']).stdout.strip()
            home = str(Path(home).parent.parent).replace('\\', '/')
            library = native_path(path / 'config.so')
            sources = [ROOT / 'android/jni/native_round_jni.cpp', *[
                ROOT / 'cpp/update_flow_core' / name for name in
                ('flow_json.cpp', 'update_flow_core.cpp', 'native_config.cpp', 'native_round.cpp', 'round_engine.cpp')]]
            build = run(['c++', '-std=c++17', '-Wall', '-Wextra', '-Werror', '-shared', '-fPIC',
                         '-I' + home + '/include', '-I' + home + '/include/linux',
                         *[native_path(item) for item in sources], '-o', library])
            self.assertEqual(build.returncode, 0, build.stderr)
            compile_java = run(['javac', '-encoding', 'UTF-8', '-d', native_path(path),
                                native_path(ROOT / 'android/src/main/java/cn/reactnative/modules/update/NativeUpdateFlow.java'),
                                native_path(java / 'NativeUpdateCore.java'), native_path(java / 'ConfigTest.java')])
            self.assertEqual(compile_java.returncode, 0, compile_java.stderr)
            result = run(['java', '-Xcheck:jni', '-Dlibrary=' + library, '-cp', native_path(path),
                          'cn.reactnative.modules.update.ConfigTest'])
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertNotIn('WARNING', result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
