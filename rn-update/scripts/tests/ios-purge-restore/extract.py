#!/usr/bin/env python3
"""Compile production Objective-C++ methods in a Foundation-only test host.

No generated source is checked in. Bodies, signatures and source locations come
from RCTPakta.mm on every run. Extraction fails on missing/ambiguous definitions;
strings/comments cannot affect brace matching. Only the test host supplies I/O.
"""

# [INPUT]: 依赖标准库 argparse/json/pathlib/re 与 RCTPakta.mm 展开的源码；提取状态、渠道身份与版本清理协作者，字面量掩码保留偏移和换行
# [OUTPUT]: 对内提供 declaration/exported_method/method/function 提取器、mask_literals、mutate 负控改写与 generate()（生成 globals/helpers/pakta/orchestrator 四个 .inc，#line 回指源文件）与 --mutation CLI
# [POS]: ios-purge-restore 测试宿主的提取引擎，每次运行从 RCTPakta.mm 现取现译；缺定义/歧义/括号失衡即 fail-closed，不检查入生成物
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

import argparse
import json
from pathlib import Path
import re


TOKENS = re.compile(
    r'//[^\n]*|/\*[\s\S]*?\*/|'
    r'(?:u8|u|U|L)?R"(?P<delimiter>[^\s()\\]{0,16})\([\s\S]*?\)(?P=delimiter)"|'
    r'"(?:\\[\s\S]|[^"\\])*"|\'(?:\\[\s\S]|[^\'\\])*\''
)


def mask_literals(source: str) -> str:
    """Preserve offsets/newlines, hiding comments and string/character literals."""
    return TOKENS.sub(lambda m: re.sub(r'[^\n]', ' ', m.group()), source)


def definition(source: str, pattern: str, label: str) -> tuple[int, str]:
    masked = mask_literals(source)
    definitions = []
    for match in re.finditer(pattern, masked, re.MULTILINE):
        opening = masked.find('{', match.end())
        semicolon = masked.find(';', match.end())
        if opening < 0 or 0 <= semicolon < opening:
            continue  # An interface declaration or a forward declaration.
        depth = 1
        cursor = opening + 1
        while depth and cursor < len(masked):
            depth += (masked[cursor] == '{') - (masked[cursor] == '}')
            cursor += 1
        if depth:
            raise ValueError(f'{label}: unterminated definition')
        definitions.append((source.count('\n', 0, match.start()) + 1,
                            source[match.start():cursor]))
    if len(definitions) != 1:
        raise ValueError(f'{label}: expected one definition, found {len(definitions)}')
    return definitions[0]


def function(source: str, name: str) -> tuple[int, str]:
    return definition(source, rf'^static\b[^\n;]*?\b{re.escape(name)}\s*\(', name)


def method(source: str, name: str) -> tuple[int, str]:
    return definition(source, rf'^\+\s*\([^\n)]*\)\s*{re.escape(name)}\b', name)


def exported_method(source: str, name: str) -> tuple[int, str]:
    return definition(source, rf'^RCT_EXPORT_METHOD\(\s*{re.escape(name)}\s*:', name)


def declaration(source: str, name: str) -> tuple[int, str]:
    matches = list(re.finditer(rf'^static\b[^\n;]*\b{re.escape(name)}\b[^\n;]*;',
                               mask_literals(source), re.MULTILINE))
    if len(matches) != 1:
        raise ValueError(f'{name}: expected one static declaration, found {len(matches)}')
    match = matches[0]
    return (source.count('\n', 0, match.start()) + 1,
            source[match.start():match.end()])


GLOBALS = [
    'keyPaktaInfo', 'paramPackageVersion', 'paramBuildTime', 'keyBinaryChannel',
    'legacyParamPackageVersion', 'legacyParamBuildTime', 'paramLastVersion',
    'paramCurrentVersion', 'paramIsFirstTime', 'paramIsFirstLoadOk', 'keyUuid',
    'keyHashInfo', 'keyFirstLoadMarked', 'keyRolledBackMarked',
    'KeyPackageUpdatedMarked', 'keyNativeCheckCache', 'BUNDLE_FILE_NAME',
    'VERSION_COMPLETE_FILE_NAME',
    'paktaStateLock', 'ignoreRollback', 'paktaIsUsingBundleUrl',
    'paktaResetGeneration', 'paktaLaunchVersion', 'paktaCrashRescueActive',
    'paktaPurgeRestoreActive', 'paktaPurgeRestoreWindowOpen',
    'paktaHostRoundResult', 'kPaktaPurgeRestoreBudget', 'kPaktaPurgeRestoreMinimumBudget',
]
HELPERS = [
    'PaktaWithStateLock', 'PaktaToStdString', 'PaktaFromStdString',
    'PaktaSetNullableString', 'PaktaHashInfoKey', 'PaktaClearVersionScopedState', 'PaktaBinaryIdentityValue',
    'PaktaStateFromDefaults', 'PaktaApplyStateToDefaults', 'PaktaSwitchVersionLocked',
    'PaktaReadInstallRecord', 'PaktaHasCompletedVersionAtPath',
    'PaktaVerifyInstallForActivation',
]
MUTATIONS = ('late-activation', 'skip-reresolve', 'ignore-reset')


def mutate(text: str, mutation: str) -> str:
    """Negative controls: prove each regression is detected, never ship a mutant."""
    patterns = {
        'late-activation': (r'\bactivation = nil;', '(void)activation;'),
        'skip-reresolve': (r'\breturn YES;', 'return !timedOut;'),
        'ignore-reset': (
            r'if \(paktaResetGeneration\.load\(\) != generation\)\s*\{\s*return;\s*\}',
            '(void)generation;'),
    }
    pattern, replacement = patterns[mutation]
    mutated, count = re.subn(pattern, replacement, text)
    if count != 1:
        raise ValueError(f'{mutation}: expected one mutation site, found {count}')
    return mutated


def production_source(source_path: Path) -> str:
    source = source_path.read_text(encoding='utf-8')
    return re.sub(r'^#include "(RCTPakta[^"/]+\.inc)"\n',
                  lambda match: production_source(source_path.parent / match[1]),
                  source, flags=re.MULTILINE)


def generate(source_path: Path, output: Path, mutation: str | None = None) -> None:
    source = production_source(source_path)
    restore = method(source, 'restorePurgedLaunch')
    commit = method(source, 'commitRoundWithGeneration')
    if mutation == 'skip-reresolve':
        restore = (restore[0], mutate(restore[1], mutation))
    elif mutation:
        commit = (commit[0], mutate(commit[1], mutation))
    sections = {
        'globals.inc': [declaration(source, name) for name in GLOBALS],
        'helpers.inc': [function(source, name) for name in HELPERS],
        'pakta.inc': [method(source, 'bundleURL'), method(source, 'resolveLaunchBundleURL'),
                      exported_method(source, 'resetToPackagedBundle')],
        'orchestrator.inc': [restore, commit],
    }
    output.mkdir(parents=True, exist_ok=True)
    filename = json.dumps(str(source_path.resolve()))
    for name, snippets in sections.items():
        output.joinpath(name).write_text(''.join(
            f'#line {line} {filename}\n{text}\n\n' for line, text in snippets
        ), encoding='utf-8')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--mutation', choices=MUTATIONS)
    args = parser.parse_args()
    try:
        generate(args.source, args.output, args.mutation)
    except (OSError, ValueError) as error:
        parser.exit(1, f'Native test extraction failed: {error}\n')


if __name__ == '__main__':
    main()
