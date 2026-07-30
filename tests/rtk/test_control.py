from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

from scripts.rtk_control import (
    codex_reference_healthy,
    elf_identity,
    inspect_pi_integration,
    parse_release_refs,
    rehearse_atomic_switch,
    sha256_file,
    task_temp_dir,
    update_dry_run,
)


ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "tests" / "rtk" / "fixtures"


def rtk_cli_argv(*arguments: str) -> list[str]:
    if os.environ.get("CODEX_GAUNTLET_CROSS_PLATFORM") == "1":
        return [
            sys.executable,
            str(ROOT / "scripts" / "rtk_control.py"),
            "--repo-root",
            str(ROOT),
            *arguments,
        ]
    return [
        str(ROOT / "scripts" / "termux-control"),
        "rtk",
        *arguments,
    ]


class ControlTests(unittest.TestCase):
    def test_release_discovery_uses_only_stable_semver_tags(self) -> None:
        releases = parse_release_refs((FIXTURES / "release-refs.txt").read_text())
        self.assertEqual(["v0.42.4", "v0.43.0", "v0.44.0"], [r["tag"] for r in releases])
        self.assertEqual("6" * 40, releases[-1]["commit"])

    def test_dry_run_reports_candidate_without_mutating_templates(self) -> None:
        protected = [
            ROOT / "config" / "rtk" / "config.toml",
            ROOT / "config" / "rtk" / "RTK.md",
            ROOT / "docs" / "provenance" / "rtk-termux-build.json",
        ]
        before = {path: sha256_file(path) for path in protected}
        report = update_dry_run(ROOT, FIXTURES / "release-refs.txt")
        after = {path: sha256_file(path) for path in protected}
        self.assertEqual(before, after)
        self.assertTrue(report["update_available"])
        self.assertEqual([], report["mutations"])
        self.assertEqual("v0.44.0", report["candidate"]["tag"])

    def test_wrapper_exposes_machine_readable_dry_run(self) -> None:
        result = subprocess.run(
            rtk_cli_argv(
                "update",
                "--dry-run",
                "--refs-file",
                str(FIXTURES / "release-refs.txt"),
                "--json",
            ),
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(0, result.returncode, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual("rtk.update.dry-run", report["operation"])
        self.assertEqual([], report["mutations"])

    def test_atomic_rehearsal_restores_exact_baseline(self) -> None:
        with task_temp_dir("rtk-switch-test") as temp:
            baseline = temp / "baseline"
            candidate = temp / "candidate"
            stage = temp / "stage"
            stage.mkdir(mode=0o700)
            baseline.write_bytes(b"baseline-binary")
            candidate.write_bytes(b"candidate-binary")
            baseline.chmod(0o700)
            candidate.chmod(0o700)
            baseline_hash = sha256_file(baseline)
            report = rehearse_atomic_switch(
                baseline,
                candidate,
                stage,
                lambda path: path.read_bytes() == b"candidate-binary",
            )
            self.assertTrue(report["switched"])
            self.assertTrue(report["candidate_valid"])
            self.assertTrue(report["rollback_ok"])
            self.assertEqual(baseline_hash, sha256_file(stage / "rtk"))

    def test_atomic_rehearsal_rolls_back_a_rejected_candidate(self) -> None:
        with task_temp_dir("rtk-switch-fail-test") as temp:
            baseline = temp / "baseline"
            candidate = temp / "candidate"
            stage = temp / "stage"
            stage.mkdir(mode=0o700)
            baseline.write_bytes(b"known-good")
            candidate.write_bytes(b"rejected")
            report = rehearse_atomic_switch(
                baseline, candidate, stage, lambda _path: False
            )
            self.assertFalse(report["candidate_valid"])
            self.assertTrue(report["rollback_ok"])
            self.assertEqual(b"known-good", (stage / "rtk").read_bytes())

    def test_codex_reference_check_does_not_require_body_output(self) -> None:
        with task_temp_dir("rtk-reference-test") as temp:
            policy = temp / "RTK.md"
            agents = temp / "AGENTS.md"
            policy.write_text("synthetic policy\n")
            agents.write_text(f"repository defaults\n@{policy}\n")
            self.assertTrue(codex_reference_healthy(agents, policy))
            agents.write_text("repository defaults\n")
            self.assertFalse(codex_reference_healthy(agents, policy))

    def test_pi_policy_materialization_and_drift_are_detected_without_bodies(self) -> None:
        with task_temp_dir("rtk-pi-policy-test") as temp:
            template = temp / "RTK.md"
            target = temp / "APPEND_SYSTEM.md"
            extension = temp / "extensions" / "rtk.ts"
            template.write_text("synthetic accuracy policy\n")

            absent = inspect_pi_integration(template, target, extension)
            self.assertFalse(absent["pi_policy_match"]["ok"])
            self.assertTrue(absent["pi_automatic_rewrite_absent"]["ok"])

            shutil.copyfile(template, target)
            materialized = inspect_pi_integration(template, target, extension)
            self.assertTrue(materialized["pi_policy_match"]["ok"])
            self.assertTrue(materialized["pi_automatic_rewrite_absent"]["ok"])

            target.write_text("synthetic drift\n")
            drifted = inspect_pi_integration(template, target, extension)
            self.assertFalse(drifted["pi_policy_match"]["ok"])

    def test_pi_automatic_rewrite_target_is_rejected(self) -> None:
        with task_temp_dir("rtk-pi-extension-test") as temp:
            template = temp / "RTK.md"
            target = temp / "APPEND_SYSTEM.md"
            extension = temp / "extensions" / "rtk.ts"
            template.write_text("synthetic accuracy policy\n")
            shutil.copyfile(template, target)
            extension.parent.mkdir()
            extension.write_text("synthetic rewrite extension\n")

            report = inspect_pi_integration(template, target, extension)
            self.assertTrue(report["pi_policy_match"]["ok"])
            self.assertFalse(report["pi_automatic_rewrite_absent"]["ok"])

    def test_non_elf_candidate_is_rejected(self) -> None:
        with task_temp_dir("rtk-elf-test") as temp:
            binary = temp / "rtk"
            binary.write_bytes(b"not-an-elf")
            self.assertFalse(elf_identity(binary)["valid"])


if __name__ == "__main__":
    unittest.main()
