from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

from gauntlet.security.contracts import ValidationRecord, finding_id, occurrence_id, validate_finding
from gauntlet.security.discovery import _target_values
from gauntlet.security.targets import NormalizedTarget


class SecurityContractTests(unittest.TestCase):
    def test_stable_finding_and_occurrence_ids(self) -> None:
        stable = finding_id("CG.SEC.TEST", "root")
        self.assertEqual(stable, finding_id("CG.SEC.TEST", "root"))
        self.assertNotEqual(occurrence_id(stable, "a", "src/a.py", 1), occurrence_id(stable, "b", "src/a.py", 1))

    def test_static_only_requires_proof_gap(self) -> None:
        finding = {
            "findingId": finding_id("CG.SEC.TEST", "root"),
            "occurrenceId": occurrence_id(finding_id("CG.SEC.TEST", "root"), "a", "src/a.py", 1),
            "ruleId": "CG.SEC.TEST", "title": "fixture", "severity": {"level": "medium"},
            "confidence": {"level": "high"}, "locations": [{"path": "src/a.py", "startLine": 1}],
            "validation": ValidationRecord("deferred", "static_only", ["source"], "2026-07-29T00:00:00Z").to_dict(),
            "attackPath": None, "provenance": {"source": "test"},
        }
        self.assertTrue(any("proofGap" in error for error in validate_finding(finding)))

    def test_repository_target_excludes_git_ignored_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
            (repo / ".gitignore").write_text("ignored/\n", encoding="utf-8")
            (repo / "tracked.py").write_text("print('tracked')\n", encoding="utf-8")
            (repo / "untracked.py").write_text("print('untracked')\n", encoding="utf-8")
            (repo / "ignored").mkdir()
            (repo / "ignored" / "danger.py").write_text(
                "eval(user_input)\n",
                encoding="utf-8",
            )
            subprocess.run(
                ["git", "add", ".gitignore", "tracked.py"],
                cwd=repo,
                check=True,
            )

            values = _target_values(
                repo,
                NormalizedTarget("repository", "standard", "UNVERSIONED"),
            )
            self.assertIn("tracked.py", values)
            self.assertIn("untracked.py", values)
            self.assertNotIn("ignored/danger.py", values)


if __name__ == "__main__":
    unittest.main()
