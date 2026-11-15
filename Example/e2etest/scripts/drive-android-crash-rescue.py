"""
[INPUT]: 依赖显式 ADB 设备/测试包、既有 Release APK 摘要、独立 brick/fix PPK 与共享救援服务
[OUTPUT]: 保存坏 JS fatal、崩溃窗口修复下载、真实 crashRescue 标记与重启保持的 UI/日志/JSON 证据
[POS]: Android 真坏 JS 救援驱动；只清理两种已知样例应用，不点击 JS 检查、不写 SDK 状态、不重建 APK
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import time
import urllib.request
import xml.etree.ElementTree as ET
import zipfile


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def main():
    parser = argparse.ArgumentParser(description='真实坏 JS → 原生 crash hold 救援，fix 无 forceBoot')
    parser.add_argument('--adb', default='adb')
    parser.add_argument('--serial', required=True)
    parser.add_argument('--package', required=True,
                        choices=['com.awesomeproject', 'space.yoghourt.pakta.expoprobe'])
    parser.add_argument('--apk', type=Path, required=True)
    parser.add_argument('--apk-sha256', required=True)
    parser.add_argument('--artifacts', type=Path, required=True)
    parser.add_argument('--evidence-dir', type=Path, required=True)
    parser.add_argument('--server', default='http://127.0.0.1:31337')
    parser.add_argument('--run-id', required=True)
    parser.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    root = args.evidence_dir.resolve()
    require(not root.exists(), 'Choose a fresh evidence directory')
    apk = args.apk.resolve()
    require(hashlib.sha256(apk.read_bytes()).hexdigest() == args.apk_sha256.lower(),
            'APK SHA-256 differs before any device command')
    proof = json.loads((args.artifacts/'build-proof.json').read_text(encoding='utf8'))
    require(proof['status'] == 'built' and proof['platform'] == 'android', 'Expected built Android rescue proof')
    with zipfile.ZipFile(apk) as archive:
        base_bundle = archive.read('assets/index.android.bundle')
    require(base_bundle[:8] == bytes.fromhex('c61fbc03c103191f'), 'APK base is not Hermes bytecode')
    hermes_version = int.from_bytes(base_bundle[8:12], 'little')
    for name in ['brick.ppk', 'fix.ppk']:
        data = (args.artifacts/name).read_bytes()
        require(hashlib.sha256(data).hexdigest() == proof['files'][name]['sha256'], f'{name} changed')
        require(proof['files'][name]['hermesVersion'] == hermes_version,
                f'{name} bytecode version differs from installed APK')
    root.mkdir(parents=True)
    result = {'status': 'prepared', 'package': args.package, 'device': args.serial,
              'apk': str(apk), 'apkSha256': args.apk_sha256, 'artifacts': proof, 'frames': []}
    (root/'inputs.json').write_text(json.dumps(result, indent=2), encoding='utf8')
    if args.verify_only:
        return

    def request(route, payload=None):
        data = None if payload is None else json.dumps(payload).encode()
        req = urllib.request.Request(args.server.rstrip('/')+route, data=data,
                                     headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=10) as response:
            return json.load(response)

    state = request('/state')
    require(state['runId'] == args.run_id and state['phase'] == 'brick' and
            not state['requests'] and not state['artifacts'], 'Expected fresh exclusive rescue server')
    for name in ['brick.ppk', 'fix.ppk']:
        require(state['files'][name]['sha256'] == proof['files'][name]['sha256'], 'Server artifacts differ')
    base = [args.adb, '-s', args.serial]

    def adb(*argv):
        completed = subprocess.run(base+list(argv), capture_output=True, timeout=40)
        if completed.returncode and not (argv[:2] == ('shell', 'pidof') and completed.returncode == 1):
            raise subprocess.CalledProcessError(completed.returncode, completed.args,
                                                completed.stdout, completed.stderr)
        return completed.stdout.decode('utf8', errors='replace').strip()

    def launch():
        adb('shell', 'am', 'force-stop', args.package)
        adb('shell', 'am', 'start', '-W', '-n', f'{args.package}/.MainActivity')

    def start_crashing(label):
        adb('shell', 'am', 'force-stop', args.package)
        offset = log_path.stat().st_size
        adb('shell', 'am', 'start', '-n', f'{args.package}/.MainActivity')
        deadline = time.monotonic()+10
        while time.monotonic() < deadline:
            value = adb('shell', 'pidof', args.package)
            if value:
                pid = value.split()[0]
                result.setdefault('launches', []).append({'stage': label, 'pid': int(pid), 'at': time.time()})
                return offset, pid
            time.sleep(.1)
        raise RuntimeError(f'{label}: did not observe the launched process PID')

    def fatal_for(content, pid):
        return ('BRICK: crash on launch' in content and
                re.search(r'Process: '+re.escape(args.package)+r', PID: '+pid+r'\b', content) is not None)

    def observe(stage, *expected, timeout=60):
        deadline = time.monotonic()+timeout
        while time.monotonic() < deadline:
            adb('shell', 'uiautomator', 'dump', '/sdcard/pakta-rescue-window.xml')
            xml = adb('exec-out', 'cat', '/sdcard/pakta-rescue-window.xml')
            texts = {node.get('text') for node in ET.fromstring(xml).iter('node')}
            if all(value in texts for value in expected):
                (root/f'{stage}.xml').write_text(xml, encoding='utf8')
                result['frames'].append({'stage': stage, 'texts': sorted(value for value in texts if value)})
                return
            time.sleep(1)
        raise RuntimeError(f'{stage}: expected {expected}')

    log_path = root/'device.log'
    result['status'] = 'running'
    with log_path.open('wb') as log:
        logger = subprocess.Popen(base+['logcat', '-T', '1', '-v', 'threadtime',
                                          'ReactNativeJS:V', 'AndroidRuntime:V', 'Pakta:V', '*:S'],
                                  stdout=log, stderr=log)
        try:
            require('Success' in adb('install', '-r', str(apk)), 'APK install failed')
            require(adb('shell', 'pm', 'clear', args.package) == 'Success', 'Sample app clear failed')
            launch()
            observe('binary-base', 'bundleLabel: BINARY_BASE', 'currentHash: (empty)')
            deadline = time.monotonic()+45
            while time.monotonic() < deadline:
                state = request('/state')
                if any(item['name'] == 'brick.ppk' and item['method'] == 'GET' and item['status'] == 200
                       for item in state['artifacts']):
                    break
                time.sleep(1)
            else:
                raise RuntimeError('Native base launch did not download brick')
            time.sleep(3)
            launch()
            # forceBootRescue 仅在原生 markSuccess 接受后发出，且会覆盖瞬态 markSuccess UI。
            observe('brick-confirmed', 'bundleLabel: BINARY_BASE_BRICK',
                    'currentHash: e2e-rescue-brick', 'lastEvent: forceBootRescue')
            deadline = time.monotonic()+25
            while time.monotonic() < deadline:
                if 'brick armed for next launch' in log_path.read_text(encoding='utf8', errors='replace'):
                    break
                time.sleep(.25)
            else:
                raise RuntimeError('Brick never armed after confirmed healthy launch')
            state = request('/state')
            require(not any(item['name'] == 'fix.ppk' and item['status'] == 200
                            for item in state['artifacts']), 'Fix was fetched before crash')
            # --- 先在 fix 封锁时证明此已确认版本确实会崩溃 ---
            withheld_offset, withheld_pid = start_crashing('brick-withheld-crash')
            deadline = time.monotonic()+45
            while time.monotonic() < deadline:
                content = log_path.read_bytes()[withheld_offset:].decode('utf8', errors='replace')
                if fatal_for(content, withheld_pid) and withheld_pid not in adb('shell', 'pidof', args.package).split():
                    break
                time.sleep(.25)
            else:
                raise RuntimeError('Withheld fix did not prove a real bad-JS fatal and process exit')
            state = request('/state')
            require(not any(item['name'] == 'fix.ppk' and item['status'] == 200
                            for item in state['artifacts']), 'Fix appeared during withheld crash')
            result['withheldCrash'] = {'pid': int(withheld_pid), 'fatal': True, 'fixAbsent': True}
            adb('shell', 'am', 'force-stop', args.package)
            request('/control/phase', {'phase': 'rescue', 'evidence': {
                'armed': True, 'fixAbsent': True, 'basis': 'fresh cleared app, confirmed brick, armed log, zero fix responses'}})
            # --- 此次启动必须先坏 JS 崩溃，fix 不含 forceBoot ---
            rescue_offset, rescue_pid = start_crashing('brick-rescue-crash')
            deadline = time.monotonic()+45
            while time.monotonic() < deadline:
                content = log_path.read_bytes()[rescue_offset:].decode('utf8', errors='replace')
                state = request('/state')
                fatal = fatal_for(content, rescue_pid)
                fetched = any(item['name'] == 'fix.ppk' and item['method'] == 'GET' and item['status'] == 200
                              and item['phase'] == 'rescue' for item in state['artifacts'])
                dead = rescue_pid not in adb('shell', 'pidof', args.package).split()
                if fatal and fetched and dead:
                    break
                time.sleep(.25)
            else:
                raise RuntimeError('No complete fatal -> crash-window fix download -> process death evidence')
            result['rescueCrash'] = {'pid': int(rescue_pid), 'fatal': True, 'fixFetchedBeforeExit': True}
            request('/control/phase', {'phase': 'sealed'})
            launch()
            observe('rescued-fix', 'bundleLabel: BINARY_BASE_FIXED', 'currentHash: e2e-rescue-fix',
                    'lastEvent: crashRescue')
            deadline = time.monotonic()+15
            native_proofs = []
            while time.monotonic() < deadline:
                content = log_path.read_text(encoding='utf8', errors='replace')
                for match in re.finditer(r'PAKTA_CRASH_RESCUE_PROOF (\{[^\n]+)', content):
                    try:
                        value, _ = json.JSONDecoder().raw_decode(match.group(1))
                        if value.get('hash') == 'e2e-rescue-fix' and value.get('crashRescue') is True:
                            native_proofs.append(value)
                    except json.JSONDecodeError:
                        continue
                if native_proofs:
                    break
                time.sleep(.25)
            require(native_proofs, 'Native hashInfo did not prove crashRescue:true')
            launch()
            observe('rescued-restart', 'bundleLabel: BINARY_BASE_FIXED', 'currentHash: e2e-rescue-fix')
            state = request('/state')
            fix_responses = [item for item in state['requests'] if item['returnedHash'] == 'e2e-rescue-fix']
            require(fix_responses and all(not item['forceBoot'] for item in fix_responses), 'Fix used forceBoot')
            result.update(status='passed', crashRescue=True, nativeProof=native_proofs[0], server=state)
        except Exception as error:
            result.update(status='failed', error=str(error))
            raise
        finally:
            logger.terminate()
            try:
                logger.wait(timeout=10)
            except subprocess.TimeoutExpired:
                logger.kill()
                logger.wait(timeout=5)
            (root/'result.json').write_text(json.dumps(result, indent=2), encoding='utf8')


if __name__ == '__main__':
    main()
