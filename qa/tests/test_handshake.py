from __future__ import annotations

import copy
import hashlib
import io
import json
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from gauntlet.handshake import (  # noqa: E402
    ReceiptIssuer,
    create_work_context,
    dirty_state_digest,
    payload_digest,
    seal_evidence_manifest,
    validate_work_context,
    write_receipt,
)
from scripts import gauntlet_handshake as handshake_adapter  # noqa: E402


class HandshakeContractTests(unittest.TestCase):
    def test_bounded_context_validates_without_story(self) -> None:
        context = create_work_context(
            ROOT,
            run_id="handshake-bounded-test",
            requested_mode="targeted",
            complexity_class="bounded",
            runnable=True,
            changed_paths=["README.md"],
        )
        self.assertNotIn("storyId", context)
        self.assertEqual(
            validate_work_context(ROOT, context, requested_mode="targeted"),
            context,
        )

    def test_context_rejects_digest_path_and_nonexistent_story(self) -> None:
        context = create_work_context(
            ROOT,
            run_id="handshake-invalid-test",
            requested_mode="ci",
            complexity_class="bounded",
            runnable=True,
            changed_paths=["README.md"],
        )
        corrupted = copy.deepcopy(context)
        corrupted["digest"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "digest mismatch"):
            validate_work_context(ROOT, corrupted)

        traversal = copy.deepcopy(context)
        traversal["scope"]["changedPaths"] = ["../escape"]
        traversal["digest"] = payload_digest(traversal)
        with self.assertRaisesRegex(ValueError, "escapes repository"):
            validate_work_context(ROOT, traversal)

        nonexistent = copy.deepcopy(context)
        nonexistent["storyId"] = "TERMUX-DOES-NOT-EXIST"
        nonexistent["harness"] = {
            "complexityClass": "complex",
            "runnable": True,
            "linkedPlan": "docs/plans/active/codex-gauntlet-v6.md",
        }
        nonexistent["digest"] = payload_digest(nonexistent)
        with mock.patch(
            "gauntlet.handshake.load_work_graph",
            return_value={"stories": []},
        ):
            with self.assertRaisesRegex(ValueError, "story does not exist"):
                validate_work_context(ROOT, nonexistent)

    def test_direct_receipt_writer_is_disabled(self) -> None:
        with self.assertRaisesRegex(PermissionError, "run ./qa/verify"):
            write_receipt(ROOT, mode="targeted")

    def test_constructed_issuer_cannot_seal_forged_evidence(self) -> None:
        temp_parent = Path(tempfile.gettempdir())
        with tempfile.TemporaryDirectory(
            prefix="gauntlet-handshake-issuer-",
            dir=temp_parent,
        ) as tmp:
            repo = Path(tmp)
            verifier = repo / "qa" / "verify_v6.py"
            verifier.parent.mkdir(parents=True)
            verifier.write_text("raise SystemExit(1)\n", encoding="utf-8")
            fake = ReceiptIssuer(
                executablePath="qa/verify_v6.py",
                executableDigest=hashlib.sha256(verifier.read_bytes()).hexdigest(),
                invocationId="verify-" + "0" * 32,
                _capability=object(),
            )
            with self.assertRaisesRegex(PermissionError, "active qa/verify"):
                seal_evidence_manifest(
                    repo,
                    fake,
                    mode="targeted",
                    target_digest="0" * 64,
                    selected_gates=["unit"],
                    command_records=[],
                    result="pass",
                    proof_gaps=[],
                    final_diff_digest_value="0" * 64,
                    final_state_checked=True,
                    started_at="2026-07-29T00:00:00Z",
                    completed_at="2026-07-29T00:00:01Z",
                )

    def test_completion_adapter_rejects_nonexistent_story(self) -> None:
        context = create_work_context(
            ROOT,
            run_id="completion-nonexistent-test",
            requested_mode="targeted",
            complexity_class="bounded",
            runnable=True,
            changed_paths=["README.md"],
        )
        artifact_root = ROOT / ".qa-artifacts"
        artifact_root.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(
            prefix="handshake-completion-",
            dir=artifact_root,
        ) as tmp:
            probe = Path(tmp) / "not-a-receipt.json"
            probe.write_text(json.dumps(context), encoding="utf-8")
            stderr = io.StringIO()
            with (
                mock.patch.object(
                    handshake_adapter,
                    "load_work_graph",
                    return_value={"stories": []},
                ),
                redirect_stderr(stderr),
            ):
                returncode = handshake_adapter.check_receipt(
                    SimpleNamespace(
                        receipt=probe.relative_to(ROOT).as_posix(),
                        story="TERMUX-DOES-NOT-EXIST",
                        json=False,
                    )
                )
        self.assertEqual(returncode, 4)
        self.assertIn("Harness story does not exist", stderr.getvalue())

    def test_lifecycle_changes_are_outside_receipt_dirty_state(self) -> None:
        temp_parent = Path(tempfile.gettempdir())
        with tempfile.TemporaryDirectory(
            prefix="gauntlet-handshake-state-",
            dir=temp_parent,
        ) as tmp:
            repo = Path(tmp)
            subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
            (repo / "app.txt").write_text("baseline\n", encoding="utf-8")
            subprocess.run(["git", "add", "app.txt"], cwd=repo, check=True)
            subprocess.run(
                [
                    "git",
                    "-c",
                    "user.name=Gauntlet Test",
                    "-c",
                    "user.email=gauntlet@example.invalid",
                    "commit",
                    "-qm",
                    "baseline",
                ],
                cwd=repo,
                check=True,
            )
            lifecycle = repo / ".harness" / "changesets" / "event.jsonl"
            lifecycle.parent.mkdir(parents=True)
            lifecycle.write_text("{}\n", encoding="utf-8")
            self.assertIsNone(dirty_state_digest(repo))
            (repo / "app.txt").write_text("changed\n", encoding="utf-8")
            self.assertIsNotNone(dirty_state_digest(repo))


if __name__ == "__main__":
    unittest.main()
