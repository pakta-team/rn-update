"""
[INPUT]: 依赖显式候选摘要、独立 Expo 宿主、ADB/UI Automator 与本地真实更新制品
[OUTPUT]: 验证安装树同源、两策略 full/diff/pdiff/v2-track 和重启保持，保存 XML/日志/JSON 证据
[POS]: Expo 设备验收边界，只清理显式测试应用数据；不注入更新状态，不修改生产网络策略
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tarfile
import time
import xml.etree.ElementTree as ET

parser = argparse.ArgumentParser(description='验证独立 Expo 测试应用的真实 OTA 更新链')
parser.add_argument('--project-root', type=Path, required=True)
parser.add_argument('--evidence-dir', type=Path, required=True)
parser.add_argument('--sdk-tarball', type=Path, required=True)
parser.add_argument('--sdk-sha256', required=True)
parser.add_argument('--verify-only', action='store_true', help='只验证候选与安装树，不访问设备')
parser.add_argument('--adb', default='adb')
parser.add_argument('--serial', required=True)
parser.add_argument('--package', default='space.yoghourt.pakta.expoprobe')
args = parser.parse_args()

def require(condition, message):
    if not condition:
        raise RuntimeError(message)

ROOT = args.evidence_dir.resolve()
ROOT.mkdir(parents=True, exist_ok=True)
HOST = args.project_root.resolve()
ADB = args.adb
PACKAGE = args.package
if not re.fullmatch(r'[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+', PACKAGE):
    parser.error('invalid test application package')
if 'probe' not in PACKAGE and 'e2e' not in PACKAGE:
    parser.error('package must explicitly identify a probe/e2e test application')
candidate = args.sdk_tarball.resolve()
require(hashlib.sha256(candidate.read_bytes()).hexdigest() == args.sdk_sha256.lower(), 'candidate SHA-256 differs')
sdk = HOST/'node_modules/rn-update'
require(not sdk.is_symlink() and not (hasattr(sdk, 'is_junction') and sdk.is_junction()), 'SDK must be a physical install')
count = 0
with tarfile.open(candidate) as archive:
    for member in archive.getmembers():
        if not member.isfile():
            continue
        require(member.name.startswith('package/'), 'candidate member outside package/')
        relative = Path(member.name.removeprefix('package/'))
        require(not relative.is_absolute() and '..' not in relative.parts, 'candidate member escapes SDK')
        require((sdk/relative).read_bytes() == archive.extractfile(member).read(), f'installed candidate differs: {relative}')
        count += 1
require(count > 0, 'candidate has no files')
(ROOT/'expo-candidate-guard.json').write_text(json.dumps({'candidate':str(candidate),'sha256':args.sdk_sha256,'files':count,'differences':[]},indent=2),encoding='utf8')
if args.verify_only:
    raise SystemExit(0)
APK = HOST / 'android/app/build/outputs/apk/release/app-release.apk'
BASE = [ADB, '-s', args.serial]
frames = []

def adb(*args):
    return subprocess.check_output(BASE + list(args), text=True, encoding='utf8', errors='replace', timeout=35).strip()

def snapshot():
    adb('shell', 'uiautomator', 'dump', '/sdcard/pakta-expo-window.xml')
    xml = adb('exec-out', 'cat', '/sdcard/pakta-expo-window.xml')
    return ET.fromstring(xml), xml

def capture(name, xml):
    (ROOT / f'expo-{name}.xml').write_text(xml, encoding='utf8')
    texts = [n.get('text') for n in ET.fromstring(xml).iter('node') if n.get('text')]
    frames.append({'stage': name, 'texts': texts})
    print(json.dumps({'stage': name, 'texts': texts}, ensure_ascii=False), flush=True)

def wait_for(name, *texts, timeout=120):
    until = time.monotonic() + timeout
    while time.monotonic() < until:
        tree, xml = snapshot()
        present = {n.get('text') for n in tree.iter('node')}
        if all(text in present for text in texts):
            capture(name, xml)
            return
        time.sleep(1)
    capture(f'{name}-failed', xml)
    raise AssertionError(f'{name}: expected {texts}')

def tap(text):
    tree, _ = snapshot()
    target = next(n for n in tree.iter('node') if n.get('text') == text)
    x1, y1, x2, y2 = map(int, re.fullmatch(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', target.get('bounds')).groups())
    adb('shell', 'input', 'tap', str((x1+x2)//2), str((y1+y2)//2))

def launch():
    adb('shell', 'am', 'force-stop', PACKAGE)
    adb('shell', 'am', 'start', '-W', '-n', f'{PACKAGE}/.MainActivity')

def base(mode):
    require(adb('shell', 'pm', 'clear', PACKAGE) == 'Success', 'could not clear test application')
    launch()
    wait_for(f'{mode}-base', 'bundleLabel: BINARY_BASE', 'currentHash: (empty)')

stages = [('E2E_FULL_V1','e2e-full-v1'), ('E2E_PPK_PATCH_V2','e2e-ppk-patch-v2'),
          ('E2E_PACKAGE_PATCH_V3','e2e-package-patch-v3'), ('E2E_V2TRACK_V4','e2e-v2track-v4')]
require(json.loads((HOST/'.e2e-artifacts/android/manifest.json').read_text())['fullFallback'] is False, 'real patches required')
require('Success' in adb('install', '-r', str(APK)), 'APK installation failed')
log = (ROOT/'expo-runtime.log').open('wb')
logger = subprocess.Popen(BASE+['logcat','-T','1','-v','threadtime','ReactNativeJS:V','AndroidRuntime:V','Pakta:V','*:S'], stdout=log, stderr=log)
try:
    for mode in ['now', 'later']:
        base(mode)
        previous_label, previous_hash = 'BINARY_BASE', '(empty)'
        for index, (label, version) in enumerate(stages, 1):
            if mode == 'later':
                tap('Use SilentAndLater')
                wait_for(f'{mode}-{index}-strategy','updateStrategy: silentAndLater')
            tap('Check Update')
            if mode == 'later':
                wait_for(f'{mode}-{index}-downloaded', f'bundleLabel: {previous_label}',
                         f'currentHash: {previous_hash}', 'lastEvent: downloadSuccess',
                         f'lastEventVersion: {version}')
                launch()
            wait_for(f'{mode}-{index}-active', f'bundleLabel: {label}', f'currentHash: {version}', 'lastEvent: markSuccess')
            launch()
            wait_for(f'{mode}-{index}-restart', f'bundleLabel: {label}', f'currentHash: {version}')
            previous_label, previous_hash = label, version
        tap('Check Update')
        wait_for(f'{mode}-up-to-date', 'lastCheckResult: upToDate', f'currentHash: {stages[-1][1]}')
    (ROOT/'expo-runtime-result.json').write_text(json.dumps({'status':'passed','frames':frames},ensure_ascii=False,indent=2), encoding='utf8')
finally:
    logger.terminate()
    logger.wait(timeout=10)
    log.close()
