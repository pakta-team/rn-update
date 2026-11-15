#!/usr/bin/env python3
"""
[INPUT]: 依赖显式 iOS Release app/Hermes版本/模拟器、当前 CLI、共享救援服务与只读 plist/安装目录
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
import shutil
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


def matches_crash_report(text, identifier, pid):
    return ("BRICK: crash on launch" in text and identifier in text and
            re.search(r'"pid"\s*:\s*' + str(pid) + r'\s*[,}]', text) is not None)


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
                       "snapshots": [], "launches": []}

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
        output = self.simctl("launch", self.args.udid, self.identifier)
        match = re.search(r": (\d+)\s*$", output)
        if not match:
            raise RuntimeError("simctl launch did not return the actual process PID: " + output)
        pid = int(match.group(1))
        self.report["launches"].append({"label": label, "pid": pid, "at": time.time()})
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

    def crashed(self, pid, since):
        wait("the genuine BRICK process exit", lambda: not self.alive(pid), 45)
        crash_dir = Path.home() / "Library/Logs/DiagnosticReports"

        def find_crash():
            for file in crash_dir.glob(self.executable + "*.ips"):
                if file.stat().st_mtime < since:
                    continue
                text = file.read_text(encoding="utf8", errors="replace")
                if matches_crash_report(text, self.identifier, pid):
                    shutil.copy2(file, self.out / file.name)
                    return {"file": file.name, "sha256": digest(file), "pid": pid}
            return None

        return wait("a BRICK exception crash report for this test app", find_crash, 60)

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
            unchanged = digest(self.app / self.executable) == self.report["appExecutableSHA256"]
            unchanged = unchanged and digest(self.app / "main.jsbundle") == self.report["packagedBundleSHA256"]
            for name in ["brick.ppk", "fix.ppk"]:
                unchanged = unchanged and digest(self.out / "artifacts" / name) == self.report["artifactBuild"]["files"][name]["sha256"]
            self.report["inputsUnchanged"] = unchanged
            if not unchanged:
                self.report.update(status="failed", error="Inputs changed during the device run")
        if self.data:
            try:
                self.report["finalState"] = self.state()
                logs = run(["xcrun", "simctl", "spawn", self.args.udid, "log", "show",
                            "--last", "15m", "--style", "compact", "--predicate",
                            'process == "' + self.executable + '"'], timeout=60)
                (self.out / "simulator.log").write_text(logs, encoding="utf8")
            except Exception as error:
                self.report["captureError"] = str(error)
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
