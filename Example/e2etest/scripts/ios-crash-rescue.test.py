"""
[INPUT]: 依赖 simctl 救援驱动的宿主身份、系统报告及逐启动原生异常证据门卫，不依赖 Apple 工具链
[OUTPUT]: 验证错误应用/Release输入、陈旧或错PID报告、普通JS日志及异常证据跨启动混用均被拒绝
[POS]: iOS 故障驱动的持久负控；不代替真实坏 JS、原生救援或模拟器执行
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import tempfile
import unittest


spec = importlib.util.spec_from_file_location(
    "ios_crash_rescue", Path(__file__).with_name("drive-ios-crash-rescue.py"))
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)


class InputGuards(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.app = Path(self.temporary.name) / "AwesomeProject.app"
        self.app.mkdir()
        self.write_info("org.reactjs.native.example.AwesomeProject")
        (self.app / "AwesomeProject").write_bytes(b"release executable fixture")
        (self.app / "main.jsbundle").write_bytes(b"packaged bundle fixture")

    def write_info(self, identifier):
        with (self.app / "Info.plist").open("wb") as file:
            plistlib.dump({"CFBundleIdentifier": identifier,
                          "CFBundleExecutable": "AwesomeProject"}, file,
                         fmt=plistlib.FMT_BINARY)

    def test_binary_plist_test_host_is_accepted(self):
        self.assertEqual(driver.require_test_app(self.app),
                         ("org.reactjs.native.example.AwesomeProject", "AwesomeProject"))

    def test_other_app_cannot_be_uninstalled(self):
        self.write_info("space.pakta.userapplication")
        with self.assertRaisesRegex(ValueError, "outside"):
            driver.require_test_app(self.app)

    def test_missing_packaged_bundle_is_rejected(self):
        (self.app / "main.jsbundle").unlink()
        with self.assertRaisesRegex(ValueError, "missing"):
            driver.require_test_app(self.app)

    def test_hermes_version_comes_from_packaged_bytes(self):
        bundle = self.app / "main.jsbundle"
        bundle.write_bytes(bytes.fromhex("c61fbc03c103191f") + (98).to_bytes(4, "little"))
        self.assertEqual(driver.hermes_version(bundle), 98)
        bundle.write_bytes(b"console.log('plain JS')")
        with self.assertRaisesRegex(ValueError, "Hermes"):
            driver.hermes_version(bundle)
        bundle.write_bytes(bytes.fromhex("c61fbc03c103191f"))
        with self.assertRaisesRegex(ValueError, "Hermes"):
            driver.hermes_version(bundle)

    def test_only_current_pid_brick_exception_is_evidence(self):
        text = json.dumps({"pid": 1234, "bundleInfo": {"CFBundleIdentifier": "org.example.AwesomeProject"},
                           "exception": {"type": "EXC_CRASH", "signal": "SIGABRT"},
                           "captureTime": "2026-11-15 04:30:00.123456+0000",
                           "reason": "Unhandled JS Exception: BRICK: crash on launch"})
        self.assertTrue(driver.matches_crash_report(text, "org.example.AwesomeProject", 1234))
        self.assertFalse(driver.matches_crash_report(text, "org.example.AwesomeProject", 123))
        self.assertFalse(driver.matches_crash_report(text, "org.other.AwesomeProject", 1234))
        self.assertFalse(driver.matches_crash_report(text.replace("BRICK", "OTHER"), "org.example.AwesomeProject", 1234))
        self.assertFalse(driver.matches_crash_report(text.replace("EXC_CRASH", "ordinary-error"),
                                                     "org.example.AwesomeProject", 1234))
        self.assertTrue(driver.matches_crash_report('{"app_name":"AwesomeProject"}\n' + text,
                                                    "org.example.AwesomeProject", 1234))
        unrelated = json.loads(text)
        unrelated["reason"] = "unrelated native crash"
        unrelated["diagnosticNote"] = "earlier ordinary log: Unhandled JS Exception: BRICK: crash on launch"
        self.assertFalse(driver.matches_crash_report(json.dumps(unrelated), "org.example.AwesomeProject", 1234))
        at = driver.event_time(json.loads(text)["captureTime"])
        self.assertTrue(driver.matches_crash_report(text, "org.example.AwesomeProject", 1234, at - 1, at + 1))
        self.assertFalse(driver.matches_crash_report(text, "org.example.AwesomeProject", 1234, at + 0.01, at + 1))
        self.assertFalse(driver.matches_crash_report(text, "org.example.AwesomeProject", 1234, at - 1, at - 0.01))
        self.assertFalse(driver.matches_crash_report(text.replace("captureTime", "unknownTime"),
                                                     "org.example.AwesomeProject", 1234))

    def test_legacy_crash_requires_process_identifier_and_fatal_type(self):
        text = ("Process: AwesomeProject [1234]\nIdentifier: org.example.AwesomeProject\n"
                "Date/Time: 2026-11-15 04:30:00.123456 +0000\n"
                "Exception Type: EXC_CRASH (SIGABRT)\n"
                "Terminating app due to uncaught exception 'RCTFatalException: Unhandled JS Exception: "
                "BRICK: crash on launch'\n")
        self.assertTrue(driver.matches_crash_report(text, "org.example.AwesomeProject", 1234))
        at = driver.event_time("2026-11-15 04:30:00.123456+0000")
        self.assertFalse(driver.matches_crash_report(text, "org.example.AwesomeProject", 1234, at + 0.01, at + 1))
        for bad in (text.replace("[1234]", "[123]"), text.replace("Identifier:", "Other:"),
                    text.replace("Exception Type:", "Other:")):
            self.assertFalse(driver.matches_crash_report(bad, "org.example.AwesomeProject", 1234))

    def test_stderr_requires_native_termination_with_brick_in_that_exception(self):
        fatal = ("*** Terminating app due to uncaught exception 'RCTFatalException: "
                 "Unhandled JS Exception: BRICK: crash on launch', reason: 'fatal'\n")
        self.assertIsNotNone(driver.fatal_stderr(fatal))
        for bad in ("BRICK: crash on launch\n", "Unhandled JS Exception: BRICK: crash on launch\n",
                    "BRICK: crash on launch\n*** Terminating app due to uncaught exception 'OTHER'\n"):
            self.assertIsNone(driver.fatal_stderr(bad))

    def test_unified_fatal_is_native_current_pid_and_launch_window(self):
        item = {"processID": 1234, "processImagePath": "/test/AwesomeProject.app/AwesomeProject",
                "subsystem": "com.facebook.react.log", "category": "native", "messageType": "Error",
                "timestamp": "2026-11-15 04:30:00.123456+0000",
                "eventMessage": "Unhandled JS Exception: Error: BRICK: crash on launch, stack: ..."}
        at = driver.datetime.fromisoformat(item["timestamp"]).timestamp()
        def match(value, since=at - 1, until=at + 1):
            return driver.unified_fatal("Filtering the log data\n" + json.dumps([value]),
                                        "AwesomeProject", 1234, since, until)
        self.assertEqual(match(item), item)
        for key, wrong in (("processID", 123), ("processImagePath", "/other/AwesomeProject"),
                           ("subsystem", "application"), ("category", "javascript"),
                           ("messageType", "Default"), ("eventMessage", "BRICK: crash on launch"),
                           ("timestamp", "2026-11-15 04:30:00")):
            self.assertIsNone(match({**item, key: wrong}), key)
        self.assertIsNone(match(item, since=at + 0.01))
        self.assertIsNone(match(item, until=at - 0.01))
        self.assertIsNone(driver.unified_fatal("not JSON", "AwesomeProject", 1234, at - 1, at + 1))

    def test_report_discovery_includes_retired_and_this_simulator_only(self):
        home = Path(self.temporary.name)
        retired = home / "Library/Logs/DiagnosticReports/Retired"
        simulator = home / "Library/Developer/CoreSimulator/Devices/CURRENT/data/Library/Logs/CrashReporter"
        other = home / "Library/Developer/CoreSimulator/Devices/OTHER/data/Library/Logs/CrashReporter"
        for root in (retired, simulator, other):
            root.mkdir(parents=True)
        expected = {retired / "AwesomeProject-old.crash", simulator / "AwesomeProject-new.ips"}
        for file in [*expected, other / "AwesomeProject.ips", retired / "Unrelated.ips", retired / "AwesomeProject.log"]:
            file.write_text("fixture", encoding="utf8")
        self.assertEqual(set(driver.crash_report_files(home, "CURRENT", "AwesomeProject")),
                         {file.resolve() for file in expected})

    def test_stale_report_is_neither_accepted_nor_copied(self):
        instance = driver.Driver.__new__(driver.Driver)
        instance.args = type("Args", (), {"udid": "CURRENT"})()
        instance.executable = "AwesomeProject"
        instance.identifier = "org.example.AwesomeProject"
        instance.out = Path(self.temporary.name) / "output"
        instance.out.mkdir()
        instance.report = {"crashReportScans": []}
        stale = Path(self.temporary.name) / "AwesomeProject.crash"
        stale.write_text("BRICK: crash on launch", encoding="utf8")
        os.utime(stale, (10, 10))
        from unittest.mock import patch
        with patch.object(driver, "crash_report_files", return_value=[stale]):
            self.assertIsNone(instance.scan_crash_reports(1234, 11))
        self.assertEqual(instance.report["crashReportScans"], [])
        self.assertFalse((instance.out / "diagnostic-reports").exists())

    def test_archived_report_and_hash_use_the_same_snapshot(self):
        instance = driver.Driver.__new__(driver.Driver)
        instance.args = type("Args", (), {"udid": "CURRENT"})()
        instance.executable = "AwesomeProject"
        instance.identifier = "org.example.AwesomeProject"
        instance.out = Path(self.temporary.name) / "output"
        instance.out.mkdir()
        instance.report = {"crashReportScans": []}
        source = Path(self.temporary.name) / "AwesomeProject.ips"
        payload = b"the snapshot matched by the evidence predicate"
        source.write_bytes(payload)
        def match_and_finish_system_write(*_):
            source.write_bytes(b"system reporter changed the file after our read")
            return True
        from unittest.mock import patch
        with patch.object(driver, "crash_report_files", return_value=[source]), \
                patch.object(driver, "matches_crash_report", side_effect=match_and_finish_system_write):
            proof = instance.scan_crash_reports(1234, 0)
        archived = instance.out / proof["file"]
        self.assertEqual(archived.read_bytes(), payload)
        self.assertEqual(proof["sha256"], driver.digest(archived))
        self.assertNotEqual(proof["sha256"], driver.digest(source))

    def test_missing_input_on_close_still_releases_server_and_writes_failure(self):
        from unittest.mock import Mock, patch
        instance = driver.Driver.__new__(driver.Driver)
        instance.app = Path(self.temporary.name) / "removed.app"
        instance.executable = "AwesomeProject"
        instance.out = Path(self.temporary.name) / "output"
        instance.out.mkdir()
        instance.data = None
        instance.server = Mock()
        instance.server_log = None
        instance.request = Mock(return_value={"phase": "sealed"})
        instance.run_id = "current-run"
        instance.report = {"status": "passed", "appExecutableSHA256": "expected", "launches": [],
                           "crashReportScans": []}
        with patch("builtins.print"):
            instance.close()
        proof = json.loads((instance.out / "result.json").read_text())
        self.assertEqual(proof["status"], "failed")
        self.assertFalse(proof["inputsUnchanged"])
        instance.server.terminate.assert_called_once()
        instance.server.wait.assert_called_once()


if __name__ == "__main__":
    unittest.main()
