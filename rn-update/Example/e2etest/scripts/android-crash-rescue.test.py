"""
[INPUT]: 依赖Android救援驱动、临时APK/PPK与摘要证明，使用记录器阻断所有ADB进程
[OUTPUT]: 验证离线身份通过及错误摘要、字节码版本、旧证据/服务在设备动作前拒绝
[POS]: 真坏JS驱动的输入边界负控，不模拟更新成功、不代替ART崩溃救援
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock
import zipfile


spec = importlib.util.spec_from_file_location(
    "android_crash_rescue", Path(__file__).with_name("drive-android-crash-rescue.py"))
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)


class InputGuards(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="pakta rescue guards ")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.artifacts = self.root / "artifacts"
        self.artifacts.mkdir()
        self.apk = self.root / "app-release.apk"
        self.bundle = bytes.fromhex("c61fbc03c103191f") + (98).to_bytes(4, "little")
        with zipfile.ZipFile(self.apk, "w") as archive:
            archive.writestr("assets/index.android.bundle", self.bundle)
        self.apk_sha = hashlib.sha256(self.apk.read_bytes()).hexdigest()
        self.proof = {"status": "built", "platform": "android", "files": {}}
        for name in ["brick.ppk", "fix.ppk"]:
            file = self.artifacts / name
            with zipfile.ZipFile(file, "w") as archive:
                archive.writestr("index.bundlejs", self.bundle + name.encode())
            self.proof["files"][name] = {
                "sha256": hashlib.sha256(file.read_bytes()).hexdigest(),
                "hermesVersion": 98,
            }
        self.write_proof()
        self.calls = []

        def reject_device(*args, **kwargs):
            self.calls.append((args, kwargs))
            raise AssertionError("An input guard attempted an ADB process")

        self.addCleanup(mock.patch.stopall)
        mock.patch.object(driver.subprocess, "run", side_effect=reject_device).start()
        mock.patch.object(driver.subprocess, "Popen", side_effect=reject_device).start()

    def write_proof(self):
        (self.artifacts / "build-proof.json").write_text(
            json.dumps(self.proof), encoding="utf8")

    def invoke(self, *, verify_only=False, evidence="evidence", apk_sha=None):
        argv = ["drive-android-crash-rescue.py", "--serial", "guard-device",
                "--package", "com.awesomeproject", "--apk", str(self.apk),
                "--apk-sha256", apk_sha or self.apk_sha,
                "--artifacts", str(self.artifacts), "--evidence-dir", str(self.root / evidence),
                "--run-id", "fresh-run", "--server", "http://127.0.0.1:1",
                "--adb", str(self.root / "never-execute-adb")]
        if verify_only:
            argv.append("--verify-only")
        with mock.patch.object(sys, "argv", argv):
            driver.main()

    def server_state(self):
        return {"runId": "fresh-run", "phase": "brick", "requests": [], "artifacts": [],
                "files": self.proof["files"]}

    def test_verify_only_accepts_matching_apk_and_ppk_without_network_or_adb(self):
        with mock.patch.object(driver.urllib.request, "urlopen",
                               side_effect=AssertionError("Offline verification used network")):
            self.invoke(verify_only=True)
        result = json.loads((self.root / "evidence/inputs.json").read_text(encoding="utf8"))
        self.assertEqual(result["status"], "prepared")
        self.assertEqual(result["apkSha256"], self.apk_sha)
        self.assertEqual(self.calls, [])

    def test_wrong_apk_sha_is_rejected_before_adb(self):
        with self.assertRaisesRegex(RuntimeError, "APK SHA-256 differs"):
            self.invoke(apk_sha="0" * 64)
        self.assertFalse((self.root / "evidence").exists())
        self.assertEqual(self.calls, [])

    def test_changed_ppk_is_rejected_before_adb(self):
        with (self.artifacts / "fix.ppk").open("ab") as file:
            file.write(b"changed")
        with self.assertRaisesRegex(RuntimeError, "fix.ppk changed"):
            self.invoke()
        self.assertEqual(self.calls, [])

    def test_mismatched_bytecode_epoch_is_rejected_before_adb(self):
        self.proof["files"]["brick.ppk"]["hermesVersion"] = 96
        self.write_proof()
        with self.assertRaisesRegex(RuntimeError, "bytecode version differs"):
            self.invoke()
        self.assertEqual(self.calls, [])

    def test_unbuilt_or_other_platform_proof_is_rejected_before_adb(self):
        for changes in [{"status": "building"}, {"platform": "ios"}]:
            with self.subTest(changes=changes):
                self.proof.update({"status": "built", "platform": "android", **changes})
                self.write_proof()
                with self.assertRaisesRegex(RuntimeError, "built Android rescue proof"):
                    self.invoke()
                self.assertEqual(self.calls, [])

    def test_existing_evidence_is_preserved_before_adb(self):
        evidence = self.root / "evidence"
        evidence.mkdir()
        (evidence / "prior.json").write_text("prior run", encoding="utf8")
        with self.assertRaisesRegex(RuntimeError, "fresh evidence directory"):
            self.invoke()
        self.assertEqual((evidence / "prior.json").read_text(encoding="utf8"), "prior run")
        self.assertEqual(self.calls, [])

    def test_stale_server_identity_phase_or_events_are_rejected_before_adb(self):
        invalid = [{"runId": "old-run"}, {"phase": "rescue"},
                   {"requests": [{"hash": ""}]}, {"artifacts": [{"name": "fix.ppk"}]}]
        for index, changes in enumerate(invalid):
            with self.subTest(changes=changes):
                state = {**self.server_state(), **changes}
                with mock.patch.object(driver.urllib.request, "urlopen",
                                       return_value=io.BytesIO(json.dumps(state).encode())):
                    with self.assertRaisesRegex(RuntimeError, "fresh exclusive rescue server"):
                        self.invoke(evidence=f"server-{index}")
                self.assertEqual(self.calls, [])

    def test_different_server_artifact_is_rejected_before_adb(self):
        state = self.server_state()
        state["files"] = {**state["files"], "fix.ppk": {"sha256": "0" * 64}}
        with mock.patch.object(driver.urllib.request, "urlopen",
                               return_value=io.BytesIO(json.dumps(state).encode())):
            with self.assertRaisesRegex(RuntimeError, "Server artifacts differ"):
                self.invoke()
        self.assertEqual(self.calls, [])


if __name__ == "__main__":
    unittest.main()
