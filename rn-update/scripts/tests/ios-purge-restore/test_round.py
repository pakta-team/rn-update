# [INPUT]: 依赖 extract 的生产片段展开/方法提取、共享轮次核、向量与 C++17/WSL
# [OUTPUT]: 受限替换生产 runOnce 命令循环并回放真实核心，关闭救援标记的负控必须失败
# [POS]: ios-purge-restore 的 Apple 轮次行为宿主，不替代 Objective-C++/Foundation 或设备编译
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from extract import method, production_source


ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / 'ios/RCTPakta/RCTPakta.mm'


def adapt(value):
    if isinstance(value, str) and value.startswith(('{', '[')):
        try:
            return json.dumps(adapt(json.loads(value)), separators=(',', ':'), ensure_ascii=False)
        except json.JSONDecodeError:
            return value
    if isinstance(value, list):
        return [adapt(item) for item in value]
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            result[key] = adapt(item)
            if key == 'packageVersion' and 'cInfo' in value and 'channel' not in value:
                result['channel'] = 'default'
        return result
    return value


def loop_source():
    body = method(production_source(SOURCE), 'runOnce')[1]
    begin = body.index('        for (;;) {')
    end = body.index('\n    } @finally {', begin)
    body = body[begin:end]
    replacements = {
        'PaktaMonotonicNow() * 1000': 'Now()',
        'paktaCrashRescueActive.load()': 'Flag("crashHold")',
        'paktaPurgeRestoreActive.load()': 'Flag("forceActivate")',
        'pakta::updateflow::StepRound(state, event)': 'CheckedStep(state, event)',
        '[defaults setObject:@YES forKey:keyNativeCheckIncomplete]': '++markers',
        'marked = YES;': 'marked = true;',
        'NSString *hash = PaktaFromStdString(command.Get("hash").AsString());':
            'std::string hash = command.Get("hash").AsString();',
        'BOOL activated': 'bool activated',
        'hash.length > 0': '!hash.empty()',
        '@synchronized (self)': '',
        'activated ? nil : [hash copy]': 'activated ? "" : hash',
        'paktaHostRoundResult = PaktaHostResult(\n'
        '                        PaktaFromStdString(command.Get("status").AsString()),\n'
        '                        PaktaFromStdString(command.Get("reason").AsString()), hash, activated);':
            'Finish(command);',
        '[self performCommand:command rolledBack:launchRolledBackVersion]': 'Perform(command)',
    }
    for old, new in replacements.items():
        if body.count(old) != 1:
            raise ValueError(f'round loop extraction drift: {old}')
        body = body.replace(old, new)
    return body


HOST = r'''
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <sstream>
#include "cpp/update_flow_core/round_engine.h"
using flowjson::Value;
Value steps;
size_t cursor = 0;
int markers = 0;
std::string paktaUnactivatedHash;
double paktaUnactivatedGeneration = 0;
void Require(bool ok) { if (!ok) std::exit(2); }
double Now() { return steps.At(cursor).Get("event").Get("now").AsNumber(); }
bool Flag(const char *key) {
    if (std::getenv("PAKTA_NEGATIVE_FLAGS")) return false;
    return steps.At(cursor).Get("event").Get(key).Truthy();
}
Value CheckedStep(const Value& state, const Value& event) {
    auto step = pakta::updateflow::StepRound(state, event);
    if (!Value::DeepEquals(step.Get("commands"), steps.At(cursor).Get("commands"))) {
        std::cerr << "step " << cursor << " actual " << flowjson::Stringify(step.Get("commands"))
                  << " expected " << flowjson::Stringify(steps.At(cursor).Get("commands")) << '\n';
        std::exit(2);
    }
    return step;
}
Value Perform(const Value&) {
    ++cursor;
    Require(cursor < steps.Size());
    return steps.At(cursor).Get("event");
}
void Finish(const Value&) {
    for (size_t i = cursor + 1; i < steps.Size(); ++i)
        Require(steps.At(i).Get("commands").Size() == 0);
}
void Run(Value event, double generation) {
    Value state;
    bool marked = false;
    LOOP
    (void)marked;
}
Value Expand(const Value& value, const Value& fixtures) {
    if (value.IsString() && !value.AsString().empty() && value.AsString()[0] == '@')
        return fixtures.Get(value.AsString().substr(1));
    if (value.IsArray()) {
        Value out = Value::Array();
        for (const auto& child : value.elements()) out.Push(Expand(child, fixtures));
        return out;
    }
    if (value.IsObject()) {
        Value out = Value::Object();
        for (const auto& child : value.members()) out.Set(child.first, Expand(child.second, fixtures));
        return out;
    }
    return value;
}
int main(int argc, char **argv) {
    Require(argc == 2);
    std::ifstream input(argv[1]);
    std::ostringstream text;
    text << input.rdbuf();
    bool ok = false;
    auto vectors = flowjson::Parse(text.str(), &ok);
    Require(ok);
    int count = 0;
    for (const auto& round : vectors.Get("rounds").elements()) {
        if (round.Get("name").AsString() == "a new start replaces a finished round") continue;
        steps = Expand(round.Get("steps"), vectors.Get("fixtures"));
        cursor = 0;
        markers = 0;
        auto start = steps.At(0).Get("event");
        std::cerr << round.Get("name").AsString() << '\n';
        Run(start, start.Get("resetGeneration").AsNumber());
        Require(markers <= 1);
        ++count;
    }
    std::cout << "Apple extracted production command loop: " << count << " replay traces passed\n";
}
'''


class RoundTests(unittest.TestCase):
    def test_extracted_loop_against_real_shared_engine(self):
        with tempfile.TemporaryDirectory(prefix='pakta-apple-round-') as directory:
            path = Path(directory)
            host = path / 'round.cpp'
            host.write_text(HOST.replace('LOOP', loop_source()), encoding='utf-8')
            vectors = path / 'vectors.json'
            vectors.write_text(json.dumps(adapt(json.loads(
                (ROOT / 'cpp/update_flow_core/tests/round-engine-vectors.json').read_text(encoding='utf-8')
            ))), encoding='utf-8')
            sources = [ROOT / 'cpp/update_flow_core' / f'{name}.cpp' for name in
                       ('flow_json', 'update_flow_core', 'native_config', 'native_round', 'round_engine')]
            if os.name == 'nt':
                def linux(value):
                    return subprocess.check_output(['wsl', '--exec', 'wslpath', '-a', str(value)], text=True).strip()
                args = ['wsl', '--exec', 'g++', '-std=c++17', '-Wall', '-Wextra', '-Werror',
                        '-I' + linux(ROOT), linux(host), *map(linux, sources), '-o', linux(path / 'round')]
                run = ['wsl', '--exec', linux(path / 'round'), linux(vectors)]
            else:
                args = ['g++', '-std=c++17', '-Wall', '-Wextra', '-Werror', '-I' + str(ROOT),
                        str(host), *map(str, sources), '-o', str(path / 'round')]
                run = [str(path / 'round'), str(vectors)]
            subprocess.run(args, check=True)
            subprocess.run(run, check=True)
            mutant = ([*run[:2], 'env', 'PAKTA_NEGATIVE_FLAGS=1', *run[2:]]
                      if os.name == 'nt' else run)
            result = subprocess.run(mutant, env={**os.environ, 'PAKTA_NEGATIVE_FLAGS': '1'},
                                    capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('actual', result.stderr)


if __name__ == '__main__':
    unittest.main()
