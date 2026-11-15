#!/usr/bin/env python3
"""
[INPUT]: 依赖隔离 RN-tvos Release 宿主、当前 CLI、simctl 与 SDK 只读安装/defaults 状态
[OUTPUT]: 验证真实 JS、原生 forceBoot 两版本、健康重启与缓存恢复；有界等待 defaults 落盘，构造拒绝也留诊断
[POS]: tvOS 设备验收驱动；服务只发版本响应，绝不写 SDK defaults、安装记录或版本目录
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
import zipfile


BUNDLE_ID = "space.yoghourt.pakta.tvvalidation"
INFO = "REACTNATIVECN_PAKTA_INFO_KEY"
CONFIG = "REACTNATIVECN_PAKTA_NATIVE_CONFIG_KEY"
HASH = "REACTNATIVECN_PAKTA_HASH_"
VERSIONS = {"base": "", "v1": "e2e-tvos-v1", "v2": "e2e-tvos-v2"}
HBC_MAGIC = bytes.fromhex("c61fbc03c103191f")


def digest(file):
    value = hashlib.sha256()
    with Path(file).open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def parsed(value):
    return json.loads(value) if isinstance(value, str) else value or {}


def run(args, timeout=120, **kwargs):
    result = subprocess.run([str(item) for item in args], capture_output=True,
                            text=True, timeout=timeout, **kwargs)
    if result.returncode:
        raise RuntimeError(f"Command failed ({result.returncode}): {args}\n"
                           f"{result.stdout}\n{result.stderr}")
    return result.stdout.strip()


def wait(label, read, timeout=90):
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        try:
            value = read()
            if value:
                return value
        except (OSError, ValueError) as error:
            last = str(error)
        time.sleep(0.5)
    raise RuntimeError(f"Timed out waiting for {label}: {last}")


def require_test_app(app):
    with (app / "Info.plist").open("rb") as source:
        info = plistlib.load(source)
    expected = {"CFBundleIdentifier": BUNDLE_ID, "CFBundleExecutable": "PaktaTVValidation",
                "DTPlatformName": "appletvsimulator", "CFBundleShortVersionString": "1.0.0",
                "CFBundleVersion": "1"}
    mismatches = {key: {"expected": value, "actual": info.get(key)}
                  for key, value in expected.items() if info.get(key) != value}
    if mismatches:
        raise ValueError("Expected the dedicated tvOS simulator Release app: " +
                         json.dumps(mismatches, ensure_ascii=False))
    if not (app / "PaktaTVValidation").is_file():
        raise ValueError("Release executable is missing")
    return info


def require_health_acknowledgement(probe):
    # ---------- 原生正常持久启动会省略 nil marker；首次启动仍必须有 accepted=true ----------
    marker = probe["metadata"].get("isFirstTime")
    if marker is not None and type(marker) is not bool:
        raise ValueError("Unexpected native first-launch marker type")
    if marker is True and probe.get("accepted") is not True:
        raise RuntimeError("The running first launch did not accept markSuccess")


def safe_cache_directory(data):
    # ---------- 删除边界只来自本次 simctl app container，不接受外部相对路径 ----------
    if not data.is_absolute() or data.is_symlink() or not data.is_dir():
        raise ValueError("App container must be a physical directory")
    root = data.resolve(strict=True)
    cache = root / "Library/Caches/rctpakta"
    for directory in [root / "Library", root / "Library/Caches", cache]:
        if directory.is_symlink():
            raise ValueError("Refusing linked cache ancestry")
    if cache.resolve() != cache or not cache.is_relative_to(root):
        raise ValueError("Cache path escaped the app container")
    if cache.exists() and not cache.is_dir():
        raise ValueError("Expected an SDK cache directory")
    return cache


class Protocol:
    def __init__(self, artifacts, output):
        self.artifacts, self.output = artifacts, output
        self.lock = threading.RLock()
        self.target = None
        self.state = {"requests": [], "artifacts": [], "probes": [], "stages": []}

    def save(self):
        temporary = self.output.with_suffix(".tmp")
        temporary.write_text(json.dumps(self.state, indent=2), encoding="utf8")
        temporary.replace(self.output)

    def record(self, collection, value):
        with self.lock:
            value = {"seq": sum(len(items) for items in self.state.values()) + 1,
                     "at": time.time(), "target": self.target, **value}
            self.state[collection].append(value)
            self.save()
            return value

    def stage(self, target, label):
        with self.lock:
            self.target = target
            return self.record("stages", {"label": label})

    def handler(self):
        protocol = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def reply(self, value, status=200):
                body = json.dumps(value).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self):
                size = int(self.headers.get("Content-Length", "0"))
                if size > 65536:
                    return self.reply({"error": "body limit"}, 413)
                payload = json.loads(self.rfile.read(size) or b"{}")
                if self.path == "/probe":
                    protocol.record("probes", payload)
                    return self.reply({"ok": True})
                if self.path == "/checkUpdate/tvos-runtime-validation":
                    with protocol.lock:
                        target = protocol.target
                        response = {"upToDate": True}
                        if target and payload.get("hash", "") != VERSIONS[target]:
                            response = {"update": True, "hash": VERSIONS[target],
                                        "name": target, "full": target + ".ppk",
                                        "paths": ["http://127.0.0.1:31338/artifacts"],
                                        "config": {"forceBoot": True}}
                        protocol.record("requests", {"body": payload, "response": response})
                    return self.reply(response)
                # ---------- 遥测不影响更新；本夹具显式关闭 JS 遥测 ----------
                return self.reply({"ok": True})

            def do_HEAD(self):
                self.serve_artifact(False)

            def do_GET(self):
                self.serve_artifact(True)

            def serve_artifact(self, body):
                with protocol.lock:
                    name = self.path.removeprefix("/artifacts/")
                    if self.path != "/artifacts/" + str(protocol.target) + ".ppk":
                        return self.reply({"error": "withheld"}, 404)
                    file = protocol.artifacts / name
                    size = file.stat().st_size
                    protocol.record("artifacts", {"name": name, "method": self.command,
                                                  "sha256": digest(file), "bytes": size})
                self.send_response(200)
                self.send_header("Content-Length", str(size))
                self.send_header("Content-Type", "application/octet-stream")
                self.end_headers()
                if body:
                    with file.open("rb") as source:
                        shutil.copyfileobj(source, self.wfile)

        return Handler


class Driver:
    def __init__(self, args):
        self.host, self.cli = Path(args.host).resolve(), Path(args.cli_root).resolve()
        self.out = Path(args.output).resolve()
        self.out.mkdir(parents=True, exist_ok=False)
        self.app = self.host / "ios/build/Build/Products/Release-appletvsimulator/PaktaTVValidation.app"
        # ---------- 构造门卫失败也保留实际打包身份，不用源码 plist 推断 Xcode 产物 ----------
        shutil.copyfile(self.app / "Info.plist", self.out / "app-Info.plist")
        with (self.app / "Info.plist").open("rb") as source:
            info = plistlib.load(source)
        identity = {key: info.get(key) for key in ["CFBundleIdentifier", "CFBundleExecutable",
                    "DTPlatformName", "CFBundleShortVersionString", "CFBundleVersion"]}
        (self.out / "app-identity.json").write_text(json.dumps(identity, indent=2), encoding="utf8")
        print("tvOS packaged app identity: " + json.dumps(identity), flush=True)
        require_test_app(self.app)
        self.udid, self.server, self.data = None, None, None
        self.protocol = Protocol(self.out / "artifacts", self.out / "server-state.json")
        self.report = {"status": "running", "githubSHA": os.environ.get("GITHUB_SHA"),
                       "runId": str(uuid.uuid4()), "launches": [], "snapshots": [], "purges": []}

    def simctl(self, *args, **kwargs):
        return run(["xcrun", "simctl", *args], **kwargs)

    def defaults(self):
        with (self.data / "Library/Preferences" / (BUNDLE_ID + ".plist")).open("rb") as source:
            return plistlib.load(source)

    def state(self):
        defaults = self.defaults()
        return {"info": parsed(defaults.get(INFO)), "nativeConfig": parsed(defaults.get(CONFIG)),
                "v1": parsed(defaults.get(HASH + VERSIONS["v1"])),
                "v2": parsed(defaults.get(HASH + VERSIONS["v2"])),
                "rollback": defaults.get("REACTNATIVECN_PAKTA_ROLLEDBACKMARKED_KEY")}

    def snapshot(self, label):
        value = self.state()
        self.report["snapshots"].append({"label": label, "at": time.time(), **value})
        return value

    def terminate(self):
        subprocess.run(["xcrun", "simctl", "terminate", self.udid, BUNDLE_ID],
                       capture_output=True, timeout=30)

    def launch(self, label, version, confirm_health=True):
        self.terminate()
        launch_id = str(uuid.uuid4())
        environment = {**os.environ, "SIMCTL_CHILD_PAKTA_TV_LAUNCH_ID": launch_id}
        output = self.simctl("launch", self.udid, BUNDLE_ID, env=environment)
        match = re.search(r": (\d+)\s*$", output)
        if not match:
            raise RuntimeError("simctl did not return an actual application PID: " + output)
        self.report["launches"].append({"label": label, "launchId": launch_id,
                                        "pid": int(match.group(1)), "at": time.time()})

        def probe():
            with self.protocol.lock:
                observations = [item for item in self.protocol.state["probes"]
                                if item.get("launchId") == launch_id]
            for item in observations:
                if (item.get("version") != version or item.get("isTV") is not True or
                        item.get("dev") is not False or item.get("rendered") is not True or
                        item.get("metadata", {}).get("currentVersion") != VERSIONS[version] or
                        item.get("metadata", {}).get("packageVersion") != "1.0.0"):
                    raise ValueError("Actual tvOS RN JS identity differs from the expected launch")
                if (Path(item["constants"]["downloadRootDir"]).resolve() !=
                        safe_cache_directory(self.data)):
                    raise ValueError("Native SDK is not using this app's Caches directory")
                return item
            return None

        observed = wait("real " + version + " JS probe for " + label, probe, 90)
        self.report["launches"][-1]["probe"] = observed
        self.simctl("io", self.udid, "screenshot", self.out / (label + ".png"))
        if version != "base":
            require_health_acknowledgement(observed)
            if confirm_health:
                wait("healthy native " + version, lambda: self.confirmed(version))
        self.snapshot(label)
        return observed

    def confirmed(self, version):
        info = self.state()["info"]
        return (info.get("currentVersion") == VERSIONS[version] and
                info.get("isFirstLoadOK") is True and info.get("isFirstTime") is not True)

    def purge_cleanup_persisted(self):
        state = self.state()
        # CFPreferences 异步写盘；配置必须保留，不能把 plist 暂缺误判为清理完成。
        return (bool(state["nativeConfig"]) and
                not state["info"].get("currentVersion") and not state["rollback"])

    def purge_restore_persisted(self, since):
        return (self.state()["v2"].get("purgeRestore") is True and
                bool(self.installed("v2", since)))

    def installed(self, version, since):
        cache = safe_cache_directory(self.data)
        with self.protocol.lock:
            gets = [item for item in self.protocol.state["artifacts"]
                    if item["at"] >= since and item["name"] == version + ".ppk" and
                    item["method"] == "GET"]
        return (gets and (cache / VERSIONS[version] / "index.bundlejs").is_file() and
                self.state()["info"].get("currentVersion") == VERSIONS[version])

    def build_artifacts(self):
        manifest = json.loads((self.cli / "package.json").read_text(encoding="utf8"))
        bin_path = manifest["bin"]
        if isinstance(bin_path, dict):
            bin_path = bin_path["pakta"]
        artifacts = self.out / "artifacts"
        artifacts.mkdir()
        proof = {}
        for version in VERSIONS:
            file = artifacts / (version + ".ppk")
            entry = "index.js" if version == "base" else "entry." + version + ".js"
            command = ["node", self.cli / bin_path, "bundle", "--platform", "ios",
                       "--entryFile", entry, "--dev", "false", "--rncli", "--hermes",
                       "--hermesBase", "none", "--output", file, "--no-interactive"]
            result = subprocess.run([str(item) for item in command], cwd=self.host,
                                    capture_output=True, text=True, timeout=600,
                                    env={**os.environ, "RNU_AUTO_UPDATE": "0", "RNU_METRO_MAX_WORKERS": "1"})
            (self.out / (version + "-bundle.log")).write_text(
                result.stdout + result.stderr, encoding="utf8")
            if result.returncode:
                raise RuntimeError("CLI bundle failed for " + version)
            with zipfile.ZipFile(file) as archive:
                if archive.testzip() is not None:
                    raise RuntimeError("CRC failed in " + file.name)
                bundle = archive.read("index.bundlejs")
            if len(bundle) < 12 or bundle[:8] != HBC_MAGIC:
                raise RuntimeError("Expected matching Hermes bytecode for " + version)
            proof[version] = {"sha256": digest(file), "bytes": file.stat().st_size,
                              "bundleSHA256": hashlib.sha256(bundle).hexdigest(),
                              "hermesVersion": int.from_bytes(bundle[8:12], "little")}
            if version == "base":
                (self.app / "main.jsbundle").write_bytes(bundle)
        if len({item["hermesVersion"] for item in proof.values()}) != 1:
            raise RuntimeError("Host and OTA Hermes versions differ")
        self.report["artifacts"] = proof
        self.report["appExecutableSHA256"] = digest(self.app / "PaktaTVValidation")
        self.report["packagedBundleSHA256"] = digest(self.app / "main.jsbundle")

    def assert_inputs_unchanged(self):
        for version, proof in self.report["artifacts"].items():
            if digest(self.out / "artifacts" / (version + ".ppk")) != proof["sha256"]:
                raise RuntimeError("OTA artifact changed during runtime validation")
        if (digest(self.app / "PaktaTVValidation") != self.report["appExecutableSHA256"] or
                digest(self.app / "main.jsbundle") != self.report["packagedBundleSHA256"]):
            raise RuntimeError("Release executable or embedded base changed during validation")
        self.report["inputsUnchanged"] = True

    def purge(self, label):
        self.terminate()
        wait("quiescent defaults", lambda: self.confirmed("v2"))
        cache = safe_cache_directory(self.data)
        if not (cache / VERSIONS["v2"] / "index.bundlejs").is_file():
            raise RuntimeError("Cannot purge without an actual installed v2")
        preferences = self.data / "Library/Preferences" / (BUNDLE_ID + ".plist")
        before = preferences.read_bytes()
        (self.out / (label + "-before.plist")).write_bytes(before)
        shutil.rmtree(cache)
        after = preferences.read_bytes()
        if after != before or cache.exists():
            raise RuntimeError("Purge changed defaults or failed to remove SDK cache")
        (self.out / (label + "-after.plist")).write_bytes(after)
        self.report["purges"].append({"label": label, "cache": str(cache),
                                      "defaultsSHA256": hashlib.sha256(before).hexdigest(),
                                      "defaultsUnchanged": True, "at": time.time()})

    def execute(self):
        self.build_artifacts()
        runtimes = json.loads(self.simctl("list", "runtimes", "--json"))["runtimes"]
        choices = [item for item in runtimes if item.get("isAvailable") and
                   ".tvOS-" in item["identifier"]]
        if not choices:
            raise RuntimeError("No available tvOS simulator runtime")
        runtime = max(choices, key=lambda item: tuple(int(x) for x in item["version"].split(".")))
        device_types = json.loads(self.simctl("list", "devicetypes", "--json"))["devicetypes"]
        device_type = next(item for item in reversed(device_types)
                           if item.get("productFamily") == "Apple TV")
        self.udid = self.simctl("create", "PaktaTV-" + self.report["runId"],
                               device_type["identifier"], runtime["identifier"])
        self.report.update({"udid": self.udid, "runtime": runtime, "deviceType": device_type})
        self.simctl("boot", self.udid)
        self.simctl("bootstatus", self.udid, "-b", timeout=600)
        self.server = ThreadingHTTPServer(("127.0.0.1", 31338), self.protocol.handler())
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.protocol.stage(None, "initial-base")
        self.simctl("install", self.udid, self.app)
        self.data = Path(self.simctl("get_app_container", self.udid, BUNDLE_ID, "data"))
        self.launch("base", "base")
        config = wait("native config after JS sync", lambda: self.state()["nativeConfig"])
        if (config.get("afterDownload") != "none" or config.get("packageVersion") != "1.0.0" or
                config.get("endpoints") !=
                ["http://127.0.0.1:31338"]):
            raise RuntimeError("JS must leave activation to native forceBoot")
        for version in ["v1", "v2"]:
            stage = self.protocol.stage(version, "native-force-" + version)
            running = "base" if version == "v1" else "v1"
            # 下载可先提交目标版本；旧 JS 探针不要求原生 currentVersion 仍停在旧版。
            self.launch("download-" + version, running, confirm_health=False)
            wait("actual native GET/install " + version,
                 lambda: self.installed(version, stage["at"]), 90)
            self.launch("activate-" + version, version)
            if self.state()[version].get("forceBootRescue") is not True:
                raise RuntimeError("Activation did not record native forceBoot authority")
            self.launch("persist-" + version, version)
        self.protocol.stage(None, "purge-no-update")
        self.purge("purge-fallback")
        fallback = self.launch("purged-base", "base")
        wait("purged tvOS state cleanup persisted", self.purge_cleanup_persisted)
        self.snapshot("purged-defaults-persisted")
        if fallback["metadata"].get("isFirstTime") is True:
            raise RuntimeError("Packaged fallback inherited update first-load state")
        stage = self.protocol.stage("v2", "force-redownload")
        self.launch("redownload-v2", "base")
        wait("native GET after purge", lambda: self.installed("v2", stage["at"]), 90)
        self.launch("recovered-v2", "v2")
        self.launch("recovered-persist-v2", "v2")
        since = time.time()
        self.purge("purge-online")
        restored = self.launch("online-restored-v2", "v2")
        wait("native purgeRestore persisted with actual GET",
             lambda: self.purge_restore_persisted(since))
        self.snapshot("online-restore-persisted")
        self.launch("online-persist-v2", "v2")
        self.report["onlineRestoreMetadata"] = restored["metadata"]
        self.assert_inputs_unchanged()
        self.report["status"] = "passed"

    def close(self):
        errors = []

        def cleanup(label, action):
            try:
                action()
            except Exception as error:
                errors.append({"action": label, "error": str(error)})

        if self.udid:
            cleanup("terminate-test-app", self.terminate)

            def capture_log():
                logs = self.simctl("spawn", self.udid, "log", "show", "--last", "20m",
                                   "--style", "compact", "--predicate",
                                   'process == "PaktaTVValidation"', timeout=90)
                (self.out / "tvos-device.log").write_text(logs, encoding="utf8")

            cleanup("device-log", capture_log)
            cleanup("shutdown-owned-simulator", lambda: self.simctl("shutdown", self.udid))
            cleanup("delete-owned-simulator", lambda: self.simctl("delete", self.udid))
        if self.server:
            cleanup("server-shutdown", self.server.shutdown)
            cleanup("server-close", self.server.server_close)
        if errors:
            self.report["cleanupErrors"] = errors
            self.report["status"] = "failed"
        (self.out / "runtime-proof.json").write_text(json.dumps(self.report, indent=2), encoding="utf8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", required=True)
    parser.add_argument("--cli-root", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    if sys.platform != "darwin":
        parser.error("This driver requires a real macOS tvOS simulator runtime")
    driver = Driver(args)
    try:
        driver.execute()
    except Exception as error:
        driver.report.update({"status": "failed", "error": str(error)})
        raise
    finally:
        driver.close()
    if driver.report["status"] != "passed":
        raise RuntimeError("tvOS runtime validation or cleanup did not pass")


if __name__ == "__main__":
    main()
