#!/usr/bin/env python3
"""
[INPUT]: 依赖 tvOS driver 的纯输入/删除边界与本地协议，不依赖 Xcode 或设备替身
[OUTPUT]: 验证输入/删除边界、异步落盘重读与超时拒绝，不允许旧版本/回滚残留或缺失下载伪造成功
[POS]: CI 安全门卫回归；不替代 tvOS 原生编译、simctl 或 JS/OTA 执行证据
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
import importlib.util
from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import plistlib
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import urllib.request
from http.server import ThreadingHTTPServer


spec = importlib.util.spec_from_file_location("tvos_driver", Path(__file__).with_name("drive-tvos-runtime.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SafetyTests(unittest.TestCase):
    def test_purge_wait_reloads_the_actual_plist_after_delayed_persistence(self):
        with tempfile.TemporaryDirectory() as directory:
            driver = module.Driver.__new__(module.Driver)
            driver.data = Path(directory)
            preferences = driver.data / "Library/Preferences" / (module.BUNDLE_ID + ".plist")
            preferences.parent.mkdir(parents=True)
            config = {"appKey": "tvos-runtime-validation"}
            preferences.write_bytes(plistlib.dumps({module.CONFIG: json.dumps(config),
                module.INFO: json.dumps({"currentVersion": module.VERSIONS["v2"]})}))
            stale = preferences.read_bytes()

            def persist(_delay):
                self.assertEqual(preferences.read_bytes(), stale)
                preferences.write_bytes(plistlib.dumps({module.CONFIG: json.dumps(config)}))

            with patch.object(module.time, "monotonic", side_effect=[0, 0.1, 0.2]), \
                    patch.object(module.time, "sleep", side_effect=persist) as sleep:
                self.assertTrue(module.wait("persisted purge cleanup", driver.purge_cleanup_persisted, 1))
            sleep.assert_called_once_with(0.5)
            self.assertEqual(driver.state()["nativeConfig"], config)

    def test_purge_wait_times_out_for_old_version_rollback_or_missing_preferences(self):
        with tempfile.TemporaryDirectory() as directory:
            driver = module.Driver.__new__(module.Driver)
            driver.data = Path(directory)
            preferences = driver.data / "Library/Preferences" / (module.BUNDLE_ID + ".plist")
            preferences.parent.mkdir(parents=True)
            configured = {module.CONFIG: json.dumps({"appKey": "tvos-runtime-validation"})}
            cases = [
                {**configured, module.INFO: json.dumps({"currentVersion": module.VERSIONS["v2"]})},
                {**configured, "REACTNATIVECN_PAKTA_ROLLEDBACKMARKED_KEY": module.VERSIONS["v2"]},
                {},
                None,
            ]
            for defaults in cases:
                with self.subTest(defaults=defaults):
                    if defaults is None:
                        preferences.unlink()
                    else:
                        preferences.write_bytes(plistlib.dumps(defaults))
                    before = preferences.read_bytes() if preferences.exists() else None
                    with patch.object(module.time, "monotonic", side_effect=[0, 0.1, 0.2, 2]), \
                            patch.object(module.time, "sleep"):
                        with self.assertRaisesRegex(RuntimeError, "Timed out waiting for persisted purge cleanup"):
                            module.wait("persisted purge cleanup", driver.purge_cleanup_persisted, 1)
                    self.assertEqual(preferences.read_bytes() if preferences.exists() else None, before)

    def test_online_restore_requires_persisted_marker_and_post_purge_get(self):
        driver = module.Driver.__new__(module.Driver)
        driver.state = lambda: {"v2": {}}
        driver.installed = lambda _version, _since: True
        self.assertFalse(driver.purge_restore_persisted(123))
        driver.state = lambda: {"v2": {"purgeRestore": True}}
        driver.installed = lambda _version, _since: False
        self.assertFalse(driver.purge_restore_persisted(123))
        calls = []
        driver.installed = lambda version, since: calls.append((version, since)) or True
        self.assertTrue(driver.purge_restore_persisted(123))
        self.assertEqual(calls, [("v2", 123)])

    def test_download_probe_allows_target_commit_but_activation_still_requires_health(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            cache = root / "Library/Caches/rctpakta"
            cache.mkdir(parents=True)
            driver = module.Driver.__new__(module.Driver)
            driver.data, driver.out, driver.udid = root, root, "owned-udid"
            driver.report = {"launches": []}
            driver.protocol = SimpleNamespace(lock=threading.RLock(), state={"probes": []})
            driver.terminate = lambda: None
            driver.snapshot = lambda _label: None
            driver.confirmed = lambda _version: False

            def simctl(command, *_args, **kwargs):
                if command == "launch":
                    driver.protocol.state["probes"].append({
                        "launchId": kwargs["env"]["SIMCTL_CHILD_PAKTA_TV_LAUNCH_ID"],
                        "version": "v1", "isTV": True, "dev": False, "rendered": True,
                        "metadata": {"currentVersion": module.VERSIONS["v1"],
                                     "packageVersion": "1.0.0", "isFirstTime": False},
                        "constants": {"downloadRootDir": str(cache)}})
                    return module.BUNDLE_ID + ": 123"
                return ""

            def immediate_wait(label, read, _timeout=90):
                value = read()
                if not value:
                    raise RuntimeError("not ready: " + label)
                return value

            driver.simctl = simctl
            with patch.object(module, "wait", immediate_wait):
                driver.launch("download-v2", "v1", confirm_health=False)
                with self.assertRaisesRegex(RuntimeError, "healthy native v1"):
                    driver.launch("activate-v1", "v1")

    def test_constructor_rejection_preserves_actual_packaged_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            host = Path(directory)
            app = host / "ios/build/Build/Products/Release-appletvsimulator/PaktaTVValidation.app"
            app.mkdir(parents=True)
            info = {"CFBundleIdentifier": module.BUNDLE_ID,
                    "CFBundleExecutable": "PaktaTVValidation", "DTPlatformName": "appletvsimulator",
                    "CFBundleShortVersionString": "2.0.0", "CFBundleVersion": "1"}
            original = plistlib.dumps(info, fmt=plistlib.FMT_BINARY)
            (app / "Info.plist").write_bytes(original)
            (app / "PaktaTVValidation").write_bytes(b"release")
            output = host / "evidence"
            stream = io.StringIO()
            with redirect_stdout(stream), self.assertRaisesRegex(ValueError, '"actual": "2.0.0"'):
                module.Driver(SimpleNamespace(host=host, cli_root=host / "cli", output=output))
            self.assertEqual((output / "app-Info.plist").read_bytes(), original)
            self.assertEqual(json.loads((output / "app-identity.json").read_text()), info)
            self.assertIn('"CFBundleShortVersionString": "2.0.0"', stream.getvalue())

    def test_release_app_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            app = Path(directory)
            info = {"CFBundleIdentifier": module.BUNDLE_ID,
                    "CFBundleExecutable": "PaktaTVValidation", "DTPlatformName": "appletvsimulator",
                    "CFBundleShortVersionString": "1.0.0", "CFBundleVersion": "1"}
            (app / "PaktaTVValidation").write_bytes(b"release")
            for key, wrong in [("CFBundleIdentifier", "space.other.app"),
                               ("CFBundleExecutable", "Other"), ("DTPlatformName", "iphonesimulator"),
                               ("CFBundleShortVersionString", None), ("CFBundleVersion", None)]:
                changed = {**info, key: wrong}
                if wrong is None:
                    del changed[key]
                (app / "Info.plist").write_bytes(plistlib.dumps(changed))
                with self.assertRaisesRegex(ValueError, "dedicated tvOS"):
                    module.require_test_app(app)
            (app / "Info.plist").write_bytes(plistlib.dumps(info))
            self.assertEqual(module.require_test_app(app), info)
            (app / "PaktaTVValidation").unlink()
            with self.assertRaisesRegex(ValueError, "executable"):
                module.require_test_app(app)

    def test_first_launch_requires_ack_but_persisted_launch_may_omit_marker(self):
        module.require_health_acknowledgement({"metadata": {}, "accepted": None})
        module.require_health_acknowledgement({"metadata": {"isFirstTime": False}, "accepted": None})
        module.require_health_acknowledgement({"metadata": {"isFirstTime": True}, "accepted": True})
        for accepted in [False, None]:
            with self.assertRaisesRegex(RuntimeError, "markSuccess"):
                module.require_health_acknowledgement({"metadata": {"isFirstTime": True}, "accepted": accepted})
        with self.assertRaisesRegex(ValueError, "marker type"):
            module.require_health_acknowledgement({"metadata": {"isFirstTime": "false"}})

    def test_cache_is_exact_app_subdirectory(self):
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory).resolve()
            cache = data / "Library/Caches/rctpakta"
            cache.mkdir(parents=True)
            preferences = data / "Library/Preferences"
            preferences.mkdir()
            self.assertEqual(module.safe_cache_directory(data), cache)
            self.assertFalse(module.safe_cache_directory(data).is_relative_to(preferences))
            cache.rmdir()
            cache.write_bytes(b"not a directory")
            with self.assertRaisesRegex(ValueError, "SDK cache directory"):
                module.safe_cache_directory(data)
        with self.assertRaisesRegex(ValueError, "physical"):
            module.safe_cache_directory(Path("relative-container"))

    def test_linked_cache_or_ancestry_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            external = root / "outside"
            external.mkdir()
            for link in ["Library", "Library/Caches", "Library/Caches/rctpakta"]:
                data = root / str(len(link))
                data.mkdir()
                target = data / link
                target.parent.mkdir(parents=True, exist_ok=True)
                target.symlink_to(external, target_is_directory=True)
                with self.assertRaisesRegex(ValueError, "linked"):
                    module.safe_cache_directory(data)
                self.assertTrue(external.is_dir())
            linked_data = root / "linked-container"
            linked_data.symlink_to(external, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, "physical"):
                module.safe_cache_directory(linked_data)

    def test_cleanup_errors_still_close_server_and_write_failed_proof(self):
        with tempfile.TemporaryDirectory() as directory:
            calls = []

            class Server:
                def shutdown(self):
                    calls.append("server-shutdown")
                    raise RuntimeError("shutdown failed")

                def server_close(self):
                    calls.append("server-close")

            driver = module.Driver.__new__(module.Driver)
            driver.out, driver.udid = Path(directory), "owned-udid"
            driver.report = {"status": "passed"}
            driver.server = Server()

            def failed(*args, **_kwargs):
                calls.append(args)
                raise RuntimeError("diagnostics unavailable")

            driver.simctl, driver.terminate = failed, failed
            driver.close()
            proof = json.loads((driver.out / "runtime-proof.json").read_text())
            self.assertEqual(proof["status"], "failed")
            self.assertIn("server-close", calls)
            self.assertEqual(len(proof["cleanupErrors"]), 5)
            self.assertTrue(any(item[:1] == ("delete",) for item in calls if isinstance(item, tuple)))

    def test_final_input_tampering_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            driver = module.Driver.__new__(module.Driver)
            driver.out = Path(directory)
            driver.app = driver.out / "app"
            driver.app.mkdir()
            (driver.out / "artifacts").mkdir()
            executable, base = driver.app / "PaktaTVValidation", driver.app / "main.jsbundle"
            executable.write_bytes(b"native")
            base.write_bytes(b"base")
            driver.report = {"appExecutableSHA256": module.digest(executable),
                             "packagedBundleSHA256": module.digest(base), "artifacts": {}}
            for version in module.VERSIONS:
                file = driver.out / "artifacts" / (version + ".ppk")
                file.write_bytes(version.encode())
                driver.report["artifacts"][version] = {"sha256": module.digest(file)}
            driver.assert_inputs_unchanged()
            for file in [executable, base, driver.out / "artifacts/v2.ppk"]:
                original = file.read_bytes()
                file.write_bytes(b"changed")
                with self.assertRaisesRegex(RuntimeError, "changed"):
                    driver.assert_inputs_unchanged()
                file.write_bytes(original)

    def test_real_http_protocol_records_only_server_forceboot_and_actual_get(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "v1.ppk").write_bytes(b"actual archive bytes")
            protocol = module.Protocol(root, root / "state.json")
            server = ThreadingHTTPServer(("127.0.0.1", 0), protocol.handler())
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base = "http://127.0.0.1:" + str(server.server_port)

            def request(path, value=None):
                body = None if value is None else json.dumps(value).encode()
                with urllib.request.urlopen(urllib.request.Request(base + path, data=body), timeout=5) as response:
                    return response.read()

            try:
                no_update = json.loads(request("/checkUpdate/tvos-runtime-validation", {"hash": ""}))
                self.assertEqual(no_update, {"upToDate": True})
                protocol.stage("v1", "test")
                update = json.loads(request("/checkUpdate/tvos-runtime-validation", {"hash": ""}))
                self.assertTrue(update["config"]["forceBoot"])
                self.assertEqual(update["hash"], module.VERSIONS["v1"])
                self.assertEqual(request("/artifacts/v1.ppk"), b"actual archive bytes")
                self.assertEqual(json.loads(request("/checkUpdate/tvos-runtime-validation",
                                                   {"hash": module.VERSIONS["v1"]})), {"upToDate": True})
                self.assertEqual(len(protocol.state["artifacts"]), 1)
                self.assertEqual(protocol.state["artifacts"][0]["method"], "GET")
                state = json.loads((root / "state.json").read_text())
                self.assertEqual(len(state["requests"]), 3)
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
