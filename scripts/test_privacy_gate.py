"""Exercise identity, packed unreachable history, filenames, and PNG rejection."""
import copy
import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import privacy_gate as gate

ROOT = gate.ROOT
APPROVAL = json.loads((ROOT / "release-allowlist.json").read_text())

class PrivacyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix=".scanner-test-", dir=ROOT.parent)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.git("init", "-b", "main")
        self.git("config", "user.name", "nature-wx-lab")
        self.git("config", "user.email", APPROVAL["allowed_git_identities"][0]["email"])
        (self.root / "safe.txt").write_text("safe content\n")
        self.git("add", "safe.txt")
        self.git("commit", "-m", "Safe fixture")

    def git(self, *args, input_bytes=None):
        return subprocess.run(["git", "-C", str(self.root), *args], input=input_bytes, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True).stdout

    def inspect(self):
        with patch.object(gate, "ROOT", self.root):
            return gate.validate_git(APPROVAL)

    def test_safe_history(self):
        self.assertEqual(self.inspect(), [])

    def test_private_email_in_unreachable_packed_commit(self):
        self.git("config", "user.email", "fixture" + "@" + "example.invalid")
        self.git("commit", "--allow-empty", "-m", "Rejected identity fixture")
        self.git("reset", "--hard", "HEAD~1")
        self.git("reflog", "expire", "--expire=now", "--all")
        self.git("repack", "-a", "-d", "--keep-unreachable")
        self.assertTrue(any("identity" in x for x in self.inspect()))

    def test_unreachable_blob(self):
        self.git("hash-object", "-w", "--stdin", input_bytes=("fixture" + "@" + "example.invalid").encode())
        self.assertTrue(any("email" in x for x in self.inspect()))

    def test_raw_filename(self):
        name = "fixture" + "@" + "example.invalid"
        (self.root / name).write_text("safe")
        self.git("add", name); self.git("commit", "-m", "Filename fixture")
        self.assertTrue(any("email" in x for x in self.inspect()))

    def test_symlink_mode(self):
        (self.root / "link").symlink_to("safe.txt")
        self.git("add", "link"); self.git("commit", "-m", "Mode fixture")
        self.assertTrue(any("mode" in x for x in self.inspect()))

    def test_unapproved_tagger(self):
        self.git("config", "user.name", "Unapproved Fixture")
        self.git("tag", "-a", "fixture-tag", "-m", "Tag fixture")
        self.assertTrue(any("tagger" in x for x in self.inspect()))

    def test_failed_object_read_is_rejected(self):
        with patch.object(gate, "run_git", side_effect=OSError("fixture")):
            self.assertTrue(gate.validate_git(APPROVAL))

    def test_local_path_and_secret(self):
        emails = {x["email"] for x in APPROVAL["allowed_git_identities"]}
        for text in ["/U" + "sers/fixture/file", "gh" + "p_" + "x" * 30]:
            self.assertTrue(gate.scan_text("fixture", text, emails, set()))

    def test_approved_image_and_metadata_rejection(self):
        record = APPROVAL["allowed_binary_assets"][0]
        data = (ROOT / record["path"]).read_bytes()
        self.assertEqual(gate.validate_binary_asset(record["path"], data, record), [])
        import struct, zlib
        body = b"Author\x00fixture"
        chunk = struct.pack(">I", len(body)) + b"tEXt" + body + struct.pack(">I", zlib.crc32(b"tEXt" + body) & 0xffffffff)
        altered = data[:-12] + chunk + data[-12:]
        self.assertTrue(gate.inspect_png(altered)[1])

if __name__ == "__main__":
    unittest.main()
