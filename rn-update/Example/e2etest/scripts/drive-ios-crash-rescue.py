#!/usr/bin/env python3
"""
[INPUT]: 依赖显式 iOS Release app/Hermes版本/模拟器、当前 CLI、共享救援服务、逐启动 stderr 与只读系统报告/plist
[OUTPUT]: 验证已确认坏 JS 的真实 fatal、无预下载且无 forceBoot 的崩溃救援及健康重启
[POS]: e2etest 的 simctl 故障驱动，绕过无法连接坏 JS 的 Detox；不写原生安装状态
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
import argparse
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import subprocess
import sys
import time
import urllib.request
import uuid


BRICK = "e2e-rescue-brick"
FIX = "e2e-rescue-fix"
INFO = "REACTNATIVECN_PAKTA_INFO_KEY"
HASH = "REACTNATIVECN_PAKTA_HASH_"
ROLLBACK = "REACTNATIVECN_PAKTA_ROLLEDBACKMARKED_KEY"


def digest(file):
    value = hashlib.sha256()
    with Path(file).open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def parsed(value):
    if isinstance(value, str):
        return json.loads(value)
    return value if isinstance(value, dict) else {}


def require_test_app(app):
    with (app / "Info.plist").open("rb") as file:
        info = plistlib.load(file)
    identifier = info.get("CFBundleIdentifier", "")
    executable = info.get("CFBundleExecutable", "")
    if not identifier.endswith(".AwesomeProject") or executable != "AwesomeProject":
        raise ValueError("Refusing to reset an app outside the AwesomeProject E2E host")
    if not (app / executable).is_file() or not (app / "main.jsbundle").is_file():
        raise ValueError("Release executable or packaged bundle is missing")
    return identifier, executable


def hermes_version(file):
    with Path(file).open("rb") as source:
        header = source.read(12)
    if len(header) != 12 or header[:8] != bytes.fromhex("c61fbc03c103191f"):
        raise ValueError("Release packaged bundle must be Hermes bytecode")
    return int.from_bytes(header[8:12], "little")


def event_time(value):
    if not isinstance(value, str):
        return None
    try:
        value = re.sub(r"\s+([+-]\d{4})$", r"\1", value.replace("Z", "+00:00"))
        stamp = datetime.fromisoformat(value)
        return stamp.timestamp() if stamp.tzinfo is not None else None
    except ValueError:
        return None


def matches_crash_report(text, identifier, pid, since=0, until=float("inf")):
    if "BRICK: crash on launch" not in text:
        return False
    # ---------- 系统报告必须同时绑定应用、实际 PID 和致命异常 ----------
    decoder = json.JSONDecoder()
    remaining = text.lstrip()
    while remaining:
        try:
            value, end = decoder.raw_decode(remaining)
        except ValueError:
            break
        remaining = remaining[end:].lstrip()
        if not isinstance(value, dict):
            continue
        bundle_info = value.get("bundleInfo", {})
        bundle = (bundle_info.get("CFBundleIdentifier", value.get("bundleID"))
                  if isinstance(bundle_info, dict) else value.get("bundleID"))
        exception = value.get("exception", {})
        captured = event_time(value.get("captureTime", value.get("timestamp")))
        reasons = [value.get(key) for key in ("exception", "asi", "applicationSpecificInformation", "reason")]
        native_reason = any(re.search(r"(?:Unhandled JS Exception|RCTFatalException)[^\n]*"
                                      r"BRICK: crash on launch", json.dumps(reason)) for reason in reasons)
        if (value.get("pid") == pid and bundle == identifier and
                isinstance(exception, dict) and str(exception.get("type", "")).startswith("EXC_") and
                native_reason and captured is not None and since <= captured <= until):
            return True
    date = re.search(r"^Date/Time:\s+([^\n]+)$", text, re.M)
    captured = event_time(date.group(1)) if date else None
    return (re.search(r"^Process:\s+AwesomeProject\s+\[" + str(pid) + r"\]\s*$", text, re.M) is not None and
            re.search(r"^Identifier:\s+" + re.escape(identifier) + r"\s*$", text, re.M) is not None and
            re.search(r"^Exception Type:\s+EXC_", text, re.M) is not None and fatal_stderr(text) is not None and
            captured is not None and since <= captured <= until)


def fatal_stderr(text):
    # ---------- 只接受原生终止行；普通 JS error、单独退出都不是崩溃证据 ----------
    return re.search(r"(?im)^.*terminating (?:app )?due to uncaught exception[^\n]*"
                     r"BRICK: crash on launch[^\n]*", text)


def unified_fatal(text, executable, pid, since, until):
    # ---------- RN 的 RCTFatal 写 native unified log；不能把 javascript 类别的普通错误算作 fatal ----------
    start = text.find("[")
    if start < 0:
        return None
    try:
        records, _ = json.JSONDecoder().raw_decode(text[start:])
    except ValueError:
        return None
    if not isinstance(records, list):
        return None
    for item in records:
        if not isinstance(item, dict):
            continue
        at = event_time(item.get("timestamp"))
        if at is None:
            continue
        message = item.get("eventMessage", "")
        if (item.get("processID") == pid and since <= at <= until and
                str(item.get("processImagePath", "")).endswith(".app/" + executable) and
                item.get("subsystem") == "com.facebook.react.log" and item.get("category") == "native" and
                item.get("messageType") in ("Error", "Fault") and
                re.search(r"Unhandled JS Exception:\s*(?:Error:\s*)?BRICK: crash on launch", message)):
            return item
    return None


def crash_report_files(home, udid, executable):
    roots = [home / "Library/Logs/DiagnosticReports",
             home / "Library/Developer/CoreSimulator/Devices" / udid / "data/Library/Logs"]
    seen = set()
    for root in roots:
        if not root.is_dir():
            continue
        for file in root.rglob(executable + "*"):
            if file.suffix not in (".ips", ".crash") or file.is_symlink() or not file.is_file():
                continue
            canonical = file.resolve()
            if canonical not in seen:
                seen.add(canonical)
                yield canonical


def run(args, **kwargs):
    result = subprocess.run([str(value) for value in args], text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            timeout=kwargs.pop("timeout", 120), **kwargs)
    if result.returncode:
        raise RuntimeError(f"Command failed ({result.returncode}): {args}\n{result.stdout}")
    return result.stdout.strip()


def wait(description, read, timeout=90):
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        try:
            value = read()
            if value:
                return value
        except (OSError, ValueError, RuntimeError) as error:
            last = str(error)
        time.sleep(0.5)
    raise RuntimeError(f"Timed out waiting for {description}; last={last}")


class Driver:
    def __init__(self, args):
        self.args = args
        self.root = Path(__file__).resolve().parent.parent
        self.out = Path(args.output).resolve()
        self.out.mkdir(parents=True, exist_ok=False)
        self.app = Path(args.app).resolve()
        self.identifier, self.executable = require_test_app(self.app)
        self.hermes = hermes_version(self.app / "main.jsbundle")
        if not re.fullmatch(r"[A-Fa-f0-9-]{36}", args.udid):
            raise ValueError("An explicit simulator UDID is required")
        self.run_id = str(uuid.uuid4())
        self.url = "http://127.0.0.1:31337"
        self.server = None
        self.server_log = None
        self.data = None
        self.report = {"status": "running", "runId": self.run_id,
                       "startedAt": time.time(),
                       "githubSHA": os.environ.get("GITHUB_SHA"),
                       "udid": args.udid, "bundleId": self.identifier,
                       "appExecutableSHA256": digest(self.app / self.executable),
                       "packagedBundleSHA256": digest(self.app / "main.jsbundle"),
                       "hermesVersion": self.hermes,
                       "snapshots": [], "launches": [], "crashReportScans": []}

    def simctl(self, *args, **kwargs):
        return run(["xcrun", "simctl", *args], **kwargs)

    def request(self, path, body=None):
        data = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(self.url + path, data=data,
                                         headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.load(response)

    def defaults(self):
        with (self.data / "Library/Preferences" / (self.identifier + ".plist")).open("rb") as file:
            return plistlib.load(file)

    def state(self):
        values = self.defaults()
        return {"info": parsed(values.get(INFO)),
                "brick": parsed(values.get(HASH + BRICK)),
                "fix": parsed(values.get(HASH + FIX)),
                "flag": parsed(values.get(HASH + "brickflag")),
                "rollback": values.get(ROLLBACK),
                "nativeConfig": values.get("REACTNATIVECN_PAKTA_NATIVE_CONFIG_KEY")}

    def snapshot(self, label):
        value = self.state()
        self.report["snapshots"].append({"label": label, "at": time.time(), **value})
        return value

    def launch(self, label):
        # ---------- 每次冷启动只终止明确的测试应用 ----------
        subprocess.run(["xcrun", "simctl", "terminate", self.args.udid, self.identifier],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
        # ---------- simctl 为本次独立启动直接重定向宿主 stderr，避免依赖系统报告的延迟/格式 ----------
        stdout = self.out / (label + ".stdout.log")
        stderr = self.out / (label + ".stderr.log")
        stdout.touch(exist_ok=False)
        stderr.touch(exist_ok=False)
        output = self.simctl("launch", "--stdout=" + str(stdout), "--stderr=" + str(stderr),
                             self.args.udid, self.identifier)
        match = re.search(r": (\d+)\s*$", output)
        if not match:
            raise RuntimeError("simctl launch did not return the actual process PID: " + output)
        pid = int(match.group(1))
        self.report["launches"].append({"label": label, "pid": pid, "at": time.time(),
                                        "stdout": stdout.name, "stderr": stderr.name})
        print(json.dumps({"launch": label, "pid": pid, "runId": self.run_id}), flush=True)
        return pid

    def alive(self, pid):
        result = subprocess.run(["ps", "-p", str(pid), "-o", "comm="],
                                capture_output=True, text=True, timeout=10)
        return result.returncode == 0 and self.executable in result.stdout

    def confirmed(self, version):
        value = self.state()
        return (value["info"].get("currentVersion") == version and
                value["info"].get("isFirstLoadOK") is True and
                value["info"].get("isFirstTime") is not True and value)

    def prepare_artifacts(self):
        output = self.out / "artifacts"
        log = run([self.args.node, self.root / "scripts/prepare-crash-rescue-artifacts.js",
                   "--project", self.root, "--cli", Path(self.args.cli_root).resolve(),
                   "--output", output, "--platform", "ios"], cwd=self.root, timeout=900)
        (self.out / "prepare-artifacts.log").write_text(log, encoding="utf8")
        proof = json.loads((output / "build-proof.json").read_text(encoding="utf8"))
        if (proof.get("status") != "built" or proof.get("platform") != "ios" or
                Path(proof["project"]).resolve() != self.root or
                Path(proof["cli"]).resolve() != Path(self.args.cli_root).resolve()):
            raise RuntimeError("Rescue artifact proof does not match this host and CLI")
        for name in ["brick.ppk", "fix.ppk"]:
            if digest(output / name) != proof["files"][name]["sha256"]:
                raise RuntimeError("Rescue artifact differs from its build proof")
            if proof["files"][name].get("hermesVersion") != self.hermes:
                raise RuntimeError("Rescue artifact bytecode version differs from the Release app")
        return proof

    def scan_crash_reports(self, pid, since, until=None):
        for file in crash_report_files(Path.home(), self.args.udid, self.executable):
            modified = file.stat().st_mtime
            if modified < since:
                continue
            payload = file.read_bytes()
            sha = hashlib.sha256(payload).hexdigest()
            text = payload.decode("utf8", errors="replace")
            matched = matches_crash_report(text, self.identifier, pid, since,
                                            time.time() if until is None else until)
            saved = self.out / "diagnostic-reports" / (sha[:12] + "-" + file.name)
            if not saved.exists():
                saved.parent.mkdir(exist_ok=True)
                saved.write_bytes(payload)
            scan = {"path": str(file), "file": str(saved.relative_to(self.out)),
                    "sha256": sha, "modifiedAt": modified, "pid": pid, "matched": matched}
            if scan not in self.report["crashReportScans"]:
                self.report["crashReportScans"].append(scan)
            if matched:
                return {**scan, "source": "system-crash-report"}
        return None

    def crashed(self, pid, since):
        wait("the genuine BRICK process exit", lambda: not self.alive(pid), 45)
        exited_at = time.time()
        launches = [item for item in self.report["launches"] if item["pid"] == pid]
        if len(launches) != 1 or launches[0]["at"] < since:
            raise RuntimeError("Crash evidence must bind exactly one current launch")
        launches[0]["exitedAt"] = exited_at
        stderr = self.out / launches[0]["stderr"]
        captures = {"last": 0, "attempt": 0}

        def find_crash():
            system = self.scan_crash_reports(pid, since, exited_at)
            if system:
                return system
            match = fatal_stderr(stderr.read_text(encoding="utf8", errors="replace"))
            if match:
                return {"file": stderr.name, "sha256": digest(stderr), "pid": pid,
                        "source": "current-launch-native-termination-stderr", "fatal": match.group(0),
                        "processExited": True, "runId": self.run_id}
            if time.monotonic() - captures["last"] >= 5:
                captures["last"] = time.monotonic()
                captures["attempt"] += 1
                file = self.out / f"fatal-unified-{pid}-{captures['attempt']}.json"
                log = self.simctl("spawn", self.args.udid, "log", "show", "--last", "5m",
                                  "--style", "json", "--predicate", f"processID == {pid}", timeout=20)
                file.write_text(log, encoding="utf8")
                fatal = unified_fatal(log, self.executable, pid, since, exited_at)
                if fatal:
                    return {"file": file.name, "sha256": digest(file), "pid": pid,
                            "source": "current-pid-native-rctfatal-unified-log", "fatal": fatal,
                            "processExited": True, "exitedAt": exited_at, "runId": self.run_id}
            return None

        return wait("a native BRICK fatal bound to this exited launch", find_crash, 60)

    def execute(self):
        run([self.args.node, self.root / "scripts/assert-local-sdk.js"], cwd=self.root)
        devices = json.loads(self.simctl("list", "devices", "available", "--json"))["devices"]
        matches = [item for runtime, items in devices.items() if ".iOS-" in runtime
                   for item in items if item["udid"] == self.args.udid]
        if len(matches) != 1:
            raise RuntimeError("Explicit UDID is not an available iOS simulator")
        if matches[0]["state"] != "Booted":
            self.simctl("boot", self.args.udid)
        self.simctl("bootstatus", self.args.udid, "-b", timeout=600)
        self.report["artifactBuild"] = self.prepare_artifacts()
        self.server_log = (self.out / "server.log").open("w", encoding="utf8")
        self.server = subprocess.Popen(
            [self.args.node, str(self.root / "scripts/crash-rescue-server.js"),
             "--artifacts", str(self.out / "artifacts"), "--evidence", str(self.out / "server-state.json"),
             "--run-id", self.run_id, "--port", "31337"],
            stdout=self.server_log, stderr=subprocess.STDOUT, cwd=self.root)
        wait("the owned rescue server", lambda: self.request("/state").get("runId") == self.run_id)
        # ---------- 使用已有 Release 原生闭包，不注入状态或预下载 fix ----------
        subprocess.run(["xcrun", "simctl", "uninstall", self.args.udid, self.identifier],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
        self.simctl("install", self.args.udid, self.app)
        self.data = Path(self.simctl("get_app_container", self.args.udid, self.identifier, "data"))
        self.launch("base-native-forceBoot")
        wait("native brick installation", lambda: self.state()["info"].get("currentVersion") == BRICK)
        self.launch("brick-first-healthy-launch")
        wait("the brick's real markSuccess", lambda: self.confirmed(BRICK))
        wait("the brick's own armed flag", lambda: self.state()["flag"].get("state") == "armed")
        armed = self.snapshot("brick-confirmed-and-armed")
        config = parsed(armed["nativeConfig"])
        if (config.get("disabled") is True or config.get("afterDownload") != "none" or
                not any(url.rstrip("/") == self.url for url in config.get("endpoints", []))):
            raise RuntimeError("Native rescue config must use this server with afterDownload=none")
        update_dir = self.data / "Library/Application Support/rctpakta"
        if (update_dir / FIX).exists():
            raise RuntimeError("Fix was downloaded before the crash-rescue window")
        withheld_since = time.time()
        self.report["withheldCrash"] = self.crashed(self.launch("brick-with-fix-withheld"), withheld_since)
        if self.state()["info"].get("currentVersion") != BRICK or (update_dir / FIX).exists():
            raise RuntimeError("Withheld fix changed version or appeared on disk")
        server = self.request("/state")
        if any(event.get("name") == "fix.ppk" and event.get("status") == 200
               for event in server["artifacts"]):
            raise RuntimeError("Fix was served before the rescue phase")
        self.request("/control/phase", {"phase": "rescue", "evidence": {"armed": True, "fixAbsent": True}})
        rescue_since = time.time()
        rescue_pid = self.launch("armed-brick-real-crash-rescue")

        def committed():
            value = self.state()
            return (value["info"].get("currentVersion") == FIX and
                    value["fix"].get("crashRescue") is True and value)

        wait("native crashRescue commit without forceBoot", committed, 30)
        self.snapshot("fix-committed-by-native-crash-rescue")
        self.report["rescueCrash"] = self.crashed(rescue_pid, rescue_since)
        self.launch("fix-first-healthy-launch")
        wait("fixed JS markSuccess", lambda: self.confirmed(FIX))
        wait("fixed JS disarming", lambda: self.state()["flag"].get("state") == "disarmed")
        self.snapshot("fix-confirmed")
        self.request("/control/phase", {"phase": "sealed"})
        self.launch("fix-persistent-relaunch")
        wait("fixed version persisting across relaunch", lambda: self.confirmed(FIX))
        final = self.snapshot("fix-persistent-and-healthy")
        if final["rollback"] or final["fix"].get("crashRescue") is not True:
            raise RuntimeError("Unexpected rollback or missing native crashRescue provenance")
        server = self.request("/state")
        fixes = [item for item in server["requests"] if item.get("returnedHash") == FIX]
        downloads = [item for item in server["artifacts"] if item.get("name") == "fix.ppk" and
                     item.get("method") == "GET" and item.get("status") == 200]
        if not fixes or any(item.get("forceBoot") for item in fixes) or not downloads:
            raise RuntimeError("Missing fix download or fix incorrectly required forceBoot")
        if any(item["phase"] != "rescue" or
               datetime.fromisoformat(item["at"].replace("Z", "+00:00")).timestamp() < rescue_since
               for item in downloads):
            raise RuntimeError("Fix download is outside the actual crash-rescue window")
        self.report.update(status="passed", server=server, noJSCheck=True,
                           noStateInjection=True, fixAbsentBeforeCrash=True,
                           fixForceBoot=False, nativeCrashRescue=True)
        self.simctl("io", self.args.udid, "screenshot", self.out / "fixed-relaunch.png")

    def close(self):
        if self.report["status"] == "passed":
            try:
                unchanged = digest(self.app / self.executable) == self.report["appExecutableSHA256"]
                unchanged = unchanged and digest(self.app / "main.jsbundle") == self.report["packagedBundleSHA256"]
                for name in ["brick.ppk", "fix.ppk"]:
                    unchanged = unchanged and digest(self.out / "artifacts" / name) == self.report["artifactBuild"]["files"][name]["sha256"]
                self.report["inputsUnchanged"] = unchanged
                if not unchanged:
                    self.report.update(status="failed", error="Inputs changed during the device run")
            except Exception as error:
                self.report.update(status="failed", inputsUnchanged=False, error="Input verification failed: " + str(error))
        if self.data:
            try:
                self.report["finalState"] = self.state()
            except Exception as error:
                self.report["stateCaptureError"] = str(error)
            try:
                logs = run(["xcrun", "simctl", "spawn", self.args.udid, "log", "show",
                            "--last", "15m", "--style", "json", "--predicate",
                            'process == "' + self.executable + '"'], timeout=60)
                (self.out / "simulator-log.json").write_text(logs, encoding="utf8")
            except Exception as error:
                self.report["logCaptureError"] = str(error)
            try:
                for launch in self.report["launches"]:
                    self.scan_crash_reports(launch["pid"], launch["at"])
            except Exception as error:
                self.report["crashReportCaptureError"] = str(error)
        if self.server:
            try:
                self.report["server"] = self.request("/state")
            except Exception as error:
                self.report["serverCaptureError"] = str(error)
        if self.server:
            self.server.terminate()
            try:
                self.server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.server.kill()
                self.server.wait(timeout=10)
        if self.server_log:
            self.server_log.close()
        (self.out / "result.json").write_text(json.dumps(self.report, ensure_ascii=False, indent=2), encoding="utf8")
        print(json.dumps({"status": self.report["status"], "runId": self.run_id,
                          "error": self.report.get("error"), "launches": self.report["launches"],
                          "crashReportScans": self.report["crashReportScans"],
                          "withheldCrash": self.report.get("withheldCrash"),
                          "rescueCrash": self.report.get("rescueCrash")}, ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app", required=True)
    parser.add_argument("--udid", required=True)
    parser.add_argument("--cli-root", default=os.environ.get("RNU_CLI_ROOT"), required=not os.environ.get("RNU_CLI_ROOT"))
    parser.add_argument("--node", default="node")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    if sys.platform != "darwin":
        parser.error("This driver requires a real macOS simctl runtime")
    driver = Driver(args)
    try:
        driver.execute()
    except Exception as error:
        driver.report.update(status="failed", error=str(error))
        raise
    finally:
        driver.close()
    if driver.report["status"] != "passed":
        raise RuntimeError(driver.report.get("error", "iOS crash rescue did not pass"))


if __name__ == "__main__":
    main()
