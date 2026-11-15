"""
[INPUT]: 依赖 simctl 救援驱动的宿主身份门卫及崩溃报告匹配，不依赖 Apple 工具链
[OUTPUT]: 验证驱动拒绝其它应用、缺失或非Hermes的Release输入和不同PID的历史异常报告
[POS]: iOS 故障驱动的持久负控；不代替真实坏 JS、原生救援或模拟器执行
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
import importlib.util
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
        text = '{"pid": 1234, "bundleID": "org.example.AwesomeProject", "reason": "BRICK: crash on launch"}'
        self.assertTrue(driver.matches_crash_report(text, "org.example.AwesomeProject", 1234))
        self.assertFalse(driver.matches_crash_report(text, "org.example.AwesomeProject", 123))
        self.assertFalse(driver.matches_crash_report(text, "org.other.AwesomeProject", 1234))
        self.assertFalse(driver.matches_crash_report(text.replace("BRICK", "OTHER"), "org.example.AwesomeProject", 1234))


if __name__ == "__main__":
    unittest.main()
