import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

from extract import declaration, function, method, production_source


ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / 'ios/RCTPakta/RCTPakta.mm'


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise ValueError(f'preflight extraction drift: {old}')
    return text.replace(old, new)


def extracted_host():
    source = production_source(SOURCE)
    elapsed = function(source, 'PaktaProcessElapsed')[1]
    network = function(source, 'PaktaHasNetworkPath')[1]
    restore = method(source, 'restorePurgedLaunch')[1]
    restore = restore[restore.index('{'):]
    for old, new in {
        '[self prepareProcess:launchRolledBackVersion]': 'Prepare()',
        '[self hasRunnableConfig]': 'configured',
        '[self startRoundWithDeadline:deadline]': 'Start(deadline)',
        'NSDictionary *result = paktaHostRoundResult;': '',
    }.items():
        restore = replace_once(restore, old, new)
    restore, count = re.subn(r'RCTLog(?:Warn|Info)\([\s\S]*?\);', '', restore)
    if count != 5:
        raise ValueError(f'preflight log extraction drift: {count}')
    restore = 'static BOOL Restore() ' + restore
    bodies = '\n'.join([elapsed, network, restore])
    bodies = bodies.replace('__block ', '').replace('^(nw_path_t path)', '[&](nw_path_t path)')
    bodies = bodies.replace('^{', '[&]{')
    constants = '\n'.join(declaration(source, name)[1] for name in
                          ('kPaktaPurgeRestoreBudget', 'kPaktaPurgeRestoreMinimumBudget'))
    return HOST.replace('CONSTANTS', constants).replace('BODIES', bodies)


HOST = r'''
#include <atomic>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <functional>
using NSTimeInterval = double;
using BOOL = bool;
constexpr bool YES = true, NO = false;
constexpr long long NSEC_PER_SEC = 1000000000;
constexpr int DISPATCH_TIME_NOW = 0, DISPATCH_QUEUE_SERIAL = 0, QOS_CLASS_USER_INITIATED = 0;
constexpr int CTL_KERN = 1, KERN_PROC = 2, KERN_PROC_PID = 3;
struct TestTimeval { long tv_sec; long tv_usec; };
#define timeval TestTimeval
struct kinfo_proc { struct { timeval p_starttime; } kp_proc; };
using dispatch_queue_t = int;
using dispatch_semaphore_t = int;
using nw_path_t = int;
using nw_path_monitor_t = int;
enum nw_path_status_t { nw_path_status_invalid, nw_path_status_satisfied,
                       nw_path_status_unsatisfied, nw_path_status_satisfiable };
double elapsedSeconds = 0, now = 100, preflightCost = 0;
double receivedDeadline = 0, waitSeconds = 0;
bool configured = true, kernelFailure = false, emptyKernel = false;
bool paktaPurgeRestoreWindowOpen = false, activated = false, metadata = false;
bool pendingActivation = false, timeout = true, signalLate = false;
int starts = 0, monitors = 0, cancels = 0, networkWaits = 0, prepares = 0;
nw_path_status_t pathStatus = nw_path_status_satisfied;
std::atomic<bool> paktaPurgeRestoreActive{false};
std::function<void(nw_path_t)> update;
std::function<void()> worker;
CONSTANTS
void Require(bool ok, const char *label) {
    if (!ok) { std::fprintf(stderr, "preflight assertion: %s\n", label); std::exit(2); }
}
int getpid() { return 7; }
int sysctl(int *mib, int n, kinfo_proc *info, size_t *size, void *, int) {
    Require(n == 4 && mib[3] == 7, "kernel process identity");
    info->kp_proc.p_starttime = {100, 0};
    if (emptyKernel) *size = 0;
    return kernelFailure ? -1 : 0;
}
int gettimeofday(timeval *value, void *) {
    value->tv_sec = 100 + static_cast<long>(elapsedSeconds);
    value->tv_usec = static_cast<long>((elapsedSeconds - static_cast<long>(elapsedSeconds)) * 1e6);
    return 0;
}
double PaktaMonotonicNow() { return now; }
void Prepare() { ++prepares; }
template<class F> void PaktaWithStateLock(F f) { f(); }
int dispatch_queue_create(const char *, int) { return 1; }
int dispatch_get_global_queue(int, int) { return 1; }
int dispatch_semaphore_create(int) { return 1; }
long long dispatch_time(int, long long ns) { return ns; }
void dispatch_semaphore_signal(int) {}
void Commit() {
    metadata = true;
    activated = paktaPurgeRestoreWindowOpen && pendingActivation;
}
void Start(double deadline) { ++starts; receivedDeadline = deadline; pendingActivation = true; }
template<class F> void dispatch_async(int, F f) { worker = f; }
template<class F> void dispatch_sync(int, F f) { f(); }
int dispatch_semaphore_wait(int, long long ns) {
    if (!worker) {
        ++networkWaits;
        Require(ns == 500000000, "network preflight bounded to half second");
        now += preflightCost;
        elapsedSeconds += preflightCost;
        return pathStatus == nw_path_status_invalid;
    }
    waitSeconds = static_cast<double>(ns) / NSEC_PER_SEC;
    worker();
    if (!timeout || signalLate) Commit();
    return timeout;
}
int nw_path_monitor_create() { ++monitors; return 1; }
void nw_path_monitor_set_queue(int, int) {}
template<class F> void nw_path_monitor_set_update_handler(int, F f) { update = f; }
nw_path_status_t nw_path_get_status(int) { return pathStatus; }
void nw_path_monitor_start(int) { if (pathStatus != nw_path_status_invalid) update(1); }
void nw_path_monitor_cancel(int) { ++cancels; }
BODIES
int main(int argc, char **argv) {
    Require(argc == 2, "scenario required");
    int scenario = std::atoi(argv[1]);
    if (scenario == 1) elapsedSeconds = 10.001;
    if (scenario == 2) elapsedSeconds = 10;
    if (scenario == 3) { elapsedSeconds = 9.75; preflightCost = 0.5; }
    if (scenario == 4) pathStatus = nw_path_status_unsatisfied;
    if (scenario == 5) pathStatus = nw_path_status_invalid;
    if (scenario == 6) pathStatus = nw_path_status_satisfiable;
    if (scenario == 7) kernelFailure = true;
    if (scenario == 8) emptyKernel = true;
    if (scenario == 9) elapsedSeconds = -2;
    if (scenario == 10) configured = false;
    if (scenario == 11) { elapsedSeconds = 4.25; preflightCost = 0.5; }
    if (scenario == 12) { timeout = true; signalLate = true; }
    if (scenario == 13) timeout = false;
    bool skipped = scenario == 1 || scenario == 3 || scenario == 4 || scenario == 10;
    bool result = Restore();
    Require(result == !skipped, "preflight skip or unconditional re-resolve");
    Require(prepares == 1, "prepare process retained");
    Require(starts == (skipped ? 0 : 1), "skips must not consume the round");
    Require(!paktaPurgeRestoreWindowOpen, "restore window closed");
    Require(paktaPurgeRestoreActive.load() == !skipped, "skips leave force activation unset");
    Require(monitors == (configured ? 1 : 0) && cancels == monitors && networkWaits == monitors,
            "monitor lifecycle and config short circuit");
    if (!skipped) {
        double budget = scenario == 2 ? 2 : scenario == 11 ? 7.25 : 12;
        Require(std::abs(waitSeconds - budget) < 1e-6, "wait deducts process and preflight elapsed");
        Require(std::abs(receivedDeadline - now - budget) < 1e-6, "round and wait share deadline budget");
        if (timeout && !signalLate) {
            Commit();
            Require(metadata && !activated, "late result persists metadata without taking launch");
        } else {
            Require(metadata && activated && result, "commit before late signal still re-resolves");
        }
    }
    std::printf("preflight scenario %d passed\n", scenario);
}
'''


class LaunchPreflightTests(unittest.TestCase):
    def test_real_extracted_preflight(self):
        host = extracted_host()
        with tempfile.TemporaryDirectory(prefix='pakta-apple-preflight-') as directory:
            path = Path(directory)
            source = path / 'preflight.cpp'
            source.write_text(host, encoding='utf-8')
            if os.name == 'nt':
                def native(value):
                    return subprocess.check_output(['wsl', '--exec', 'wslpath', '-a', str(value)], text=True).strip()
                prefix = ['wsl', '--exec']
            else:
                native = str
                prefix = []
            binary = native(path / 'preflight')
            subprocess.run([*prefix, 'g++', '-std=c++17', '-Wall', '-Wextra', '-Werror',
                            native(source), '-o', binary], check=True)
            for scenario in range(14):
                with self.subTest(scenario=scenario):
                    subprocess.run([*prefix, binary, str(scenario)], check=True)
            mutations = (
                ('fresh-budget', 'kPaktaPurgeRestoreBudget - PaktaProcessElapsed()',
                 'kPaktaPurgeRestoreBudget - 0 * PaktaProcessElapsed()', '1'),
                ('offline-allowed', 'return result != nw_path_status_unsatisfied;',
                 'return result == result;', '4'),
                ('skip-reresolve', 'return YES;', 'return !timedOut;', '12'),
                ('full-wait', '(int64_t)(budget * NSEC_PER_SEC)',
                 '(int64_t)(kPaktaPurgeRestoreBudget * NSEC_PER_SEC)', '11'),
            )
            for name, old, new, scenario in mutations:
                with self.subTest(mutation=name):
                    mutant = replace_once(host, old, new)
                    if name == 'offline-allowed':
                        mutant = mutant.replace('return result == result;',
                                                '(void)result; return YES;')
                    source.write_text(mutant, encoding='utf-8')
                    subprocess.run([*prefix, 'g++', '-std=c++17', '-Wall', '-Wextra', '-Werror',
                                    native(source), '-o', binary], check=True)
                    result = subprocess.run([*prefix, binary, scenario], capture_output=True, text=True)
                    self.assertEqual(result.returncode, 2)
                    self.assertIn('preflight assertion:', result.stderr)


if __name__ == '__main__':
    unittest.main()
