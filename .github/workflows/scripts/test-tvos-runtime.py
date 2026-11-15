#!/usr/bin/env python3
"""
[INPUT]: 依赖 tvOS driver 的纯输入/删除边界与本地协议，不依赖 Xcode 或设备替身
[OUTPUT]: 验证非测试应用、路径逃逸、链接、输入漂移和清理失败均不能伪造运行成功
[POS]: CI 安全门卫回归；不替代 tvOS 原生编译、simctl 或 JS/OTA 执行证据
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
import importlib.util
import json
from pathlib import Path
import plistlib
import tempfile
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer


spec = importlib.util.spec_from_file_location("tvos_driver", Path(__file__).with_name("drive-tvos-runtime.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SafetyTests(unittest.TestCase):
    def test_release_app_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            app = Path(directory)
            info = {"CFBundleIdentifier": module.BUNDLE_ID,
                    "CFBundleExecutable": "PaktaTVValidation", "DTPlatformName": "appletvsimulator"}
            (app / "PaktaTVValidation").write_bytes(b"release")
            for key, wrong in [("CFBundleIdentifier", "space.other.app"),
                               ("CFBundleExecutable", "Other"), ("DTPlatformName", "iphonesimulator")]:
                (app / "Info.plist").write_bytes(plistlib.dumps({**info, key: wrong}))
                with self.assertRaisesRegex(ValueError, "dedicated tvOS"):
                    module.require_test_app(app)
            (app / "Info.plist").write_bytes(plistlib.dumps(info))
            self.assertEqual(module.require_test_app(app), info)
            (app / "PaktaTVValidation").unlink()
            with self.assertRaisesRegex(ValueError, "executable"):
                module.require_test_app(app)

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
