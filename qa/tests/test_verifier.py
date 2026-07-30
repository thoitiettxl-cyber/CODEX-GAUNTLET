from __future__ import annotations

import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from qa import policy_audit
from qa.verify_v6 import (
    EvidenceRunner,
    ROOT,
    _canonical_ref,
    _effective_exit_code,
    _functional_argv,
    _project_proof_gaps,
    _security_target_args,
)

RUN_CONFIGURED_PATH = ROOT / "qa/run-configured.py"
RUN_CONFIGURED_SPEC = importlib.util.spec_from_file_location(
    "qa_run_configured",
    RUN_CONFIGURED_PATH,
)
assert RUN_CONFIGURED_SPEC is not None and RUN_CONFIGURED_SPEC.loader is not None
run_configured = importlib.util.module_from_spec(RUN_CONFIGURED_SPEC)
RUN_CONFIGURED_SPEC.loader.exec_module(run_configured)


class VerifierContractTests(unittest.TestCase):
    def test_termux_wrapper_delegates_to_internal_verifier(self) -> None:
        wrapper = (ROOT / "qa/verify").read_text(encoding="utf-8")
        self.assertTrue(wrapper.startswith("#!/data/data/com.termux/files/usr/bin/bash"))
        self.assertIn("qa/verify_v6.py", wrapper)
        self.assertTrue((ROOT / "qa/verify").stat().st_mode & 0o111)

    def test_cross_platform_functional_gate_uses_runner_bash(self) -> None:
        self.assertEqual(
            ["bash", "qa/run-build.sh"],
            _functional_argv("build", cross_platform=True),
        )
        self.assertEqual(
            ["qa/run-build.sh"],
            _functional_argv("build", cross_platform=False),
        )

    def test_missing_declared_consumer_gate_becomes_proof_gap(self) -> None:
        gaps = _project_proof_gaps(["migration"])
        self.assertEqual(1, len(gaps))
        self.assertIn("consumer command missing", gaps[0])
        self.assertEqual([], _project_proof_gaps(["unit"]))

    def test_security_target_scope_is_mode_specific(self) -> None:
        self.assertEqual(
            ["--repository"],
            _security_target_args("audit", None, ["src/app.py"]),
        )
        self.assertEqual(
            ["--diff", "HEAD..HEAD"],
            _security_target_args("ci", "HEAD", ["src/app.py"]),
        )

    def test_command_record_binds_argv_exit_and_log_digest(self) -> None:
        invocation = f"unit-evidence-{time.time_ns()}"
        runner = EvidenceRunner(invocation)
        try:
            runner.run("unit-probe", [sys.executable, "-c", "print('ok')"])
            self.assertEqual(1, len(runner.records))
            record = runner.records[0]
            self.assertEqual(0, record["exitCode"])
            self.assertEqual("unit-probe", record["gate"])
            self.assertRegex(record["logSha256"], r"^[0-9a-f]{64}$")
            self.assertTrue((ROOT / record["logPath"]).is_file())
        finally:
            shutil.rmtree(runner.root)

    def test_invalid_base_is_not_silently_accepted(self) -> None:
        self.assertIsNone(_canonical_ref("--not-a-ref"))
        self.assertIsNone(_canonical_ref("definitely-missing-ref"))
        self.assertRegex(_canonical_ref("HEAD") or "", r"^[0-9a-f]{40}$")

    def test_verifier_source_has_no_harness_lifecycle_mutation(self) -> None:
        source = (ROOT / "qa/verify_v6.py").read_text(encoding="utf-8")
        self.assertIn('"qa/selftest/v6.py"', source)
        self.assertNotRegex(source.lower(), r"\b(?:create|transition).*story")
        self.assertNotIn("receipt-links", source)

    def test_policy_audit_uses_current_git_visible_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
            tracked = repo / "tracked.md"
            tracked.write_text("tracked\n", encoding="utf-8")
            subprocess.run(["git", "add", "tracked.md"], cwd=repo, check=True)
            tracked.unlink()
            (repo / "new-requirements.txt").write_text(
                "codex-security\n",
                encoding="utf-8",
            )

            with patch.object(policy_audit, "ROOT", repo):
                tracked_paths = policy_audit.tracked_files()
                changed_paths = policy_audit.changed_files()
                current = policy_audit.current_paths(tracked_paths, changed_paths)

            self.assertNotIn("tracked.md", current)
            self.assertIn("new-requirements.txt", current)

    def test_policy_audit_parallel_authority_scan_ignores_deleted_path(self) -> None:
        self.assertEqual(
            [],
            policy_audit._parallel_authority_errors(["deleted-document.md"]),
        )

    def test_all_declared_consumer_commands_normalize_without_a_shell(self) -> None:
        config = json.loads(
            (ROOT / "qa/project-commands.json").read_text(encoding="utf-8")
        )
        for commands in config["commands"].values():
            for command in commands:
                argv = run_configured.command_argv(command)
                self.assertTrue(argv)
                self.assertNotIn("&&", argv)

    def test_configured_artifact_prelude_is_bounded(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            with patch.object(run_configured, "ROOT", repo):
                argv = run_configured.command_argv(
                    "mkdir -p .qa-artifacts/coverage && python3 -c 'print(1)'"
                )
                self.assertTrue((repo / ".qa-artifacts/coverage").is_dir())
                with self.assertRaisesRegex(ValueError, "escapes repository"):
                    run_configured.command_argv(
                        "mkdir -p ../outside && python3 -c 'print(1)'"
                    )
        self.assertEqual(["python3", "-c", "print(1)"], argv)

    def test_coverage_cannot_mask_unittest_failure_with_zero_exit(self) -> None:
        output = "Ran 1 test\n\nFAILED (failures=1)\n"
        self.assertEqual(1, _effective_exit_code("coverage", output, 0))
        self.assertEqual(0, _effective_exit_code("unit", output, 0))
        self.assertEqual(7, _effective_exit_code("coverage", "OK\n", 7))


if __name__ == "__main__":
    unittest.main()
