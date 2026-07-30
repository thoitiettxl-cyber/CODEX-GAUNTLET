from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
import unittest
from contextlib import closing

from tests.continuity.support import ROOT, ContinuityFixture


class ContinuityCliTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture = ContinuityFixture()
        self.fixture.bind()

    def tearDown(self) -> None:
        self.fixture.close()

    @staticmethod
    def cli_argv(*arguments: str) -> list[str]:
        if os.environ.get("CODEX_GAUNTLET_CROSS_PLATFORM") == "1":
            return [
                sys.executable,
                str(ROOT / "scripts" / "continuity_cli.py"),
                "--repo-root",
                str(ROOT),
                *arguments,
            ]
        return [
            str(ROOT / "scripts" / "termux-control"),
            "continuity",
            *arguments,
        ]

    def run_cli(self, *arguments: str, expected: int = 0):
        result = subprocess.run(
            self.cli_argv(*arguments),
            cwd=ROOT,
            env=self.fixture.environment,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=10,
        )
        self.assertEqual(expected, result.returncode, result.stderr)
        return json.loads(result.stdout)

    def test_checkpoint_status_verify_recover_and_audit_commands(self) -> None:
        checkpoint = self.run_cli(
            "checkpoint",
            "--session",
            "fixture-session",
            "--safe-boundary",
            "CLI checkpoint recorded.",
            "--next-action",
            "Run continuity verify.",
            "--completed-operation",
            "store",
            "--pending-operation",
            "canonical gate",
            "--external-side-effect",
            "no write",
            "--verification",
            '{"focused":"pass"}',
        )["checkpoint"]
        self.assertEqual("CLI checkpoint recorded.", checkpoint["last_safe_boundary"])

        status = self.run_cli("status", "--session", "fixture-session")
        self.assertEqual(self.fixture.story_id, status["binding"]["story_id"])
        self.assertEqual(checkpoint["id"], status["checkpoint"]["id"])

        verified = self.run_cli("verify")
        self.assertEqual("ok", verified["quick_check"])
        self.assertEqual(0, verified["invalid_checkpoints"])

        with closing(sqlite3.connect(self.fixture.store.path)) as connection, connection:
            connection.execute(
                "UPDATE checkpoint SET checksum='cli-corrupt' WHERE id=?",
                (checkpoint["id"],),
            )
        previous = self.fixture.checkpoint(
            boundary="Recovery predecessor.",
            next_action="Recover from this packet.",
        )
        with closing(sqlite3.connect(self.fixture.store.path)) as connection, connection:
            connection.execute(
                "UPDATE checkpoint SET checksum='cli-corrupt-newest' WHERE id=?",
                (previous["id"],),
            )
        # The first row is also corrupt in this scenario, so seed one valid
        # forensic predecessor through the store before corrupting only a new head.
        with closing(sqlite3.connect(self.fixture.store.path)) as connection, connection:
            connection.execute(
                "UPDATE checkpoint SET checksum=? WHERE id=?",
                (checkpoint["checksum"], checkpoint["id"]),
            )
        recovered = self.run_cli(
            "recover", "--session", "fixture-session"
        )["recovered"]
        self.assertEqual(checkpoint["id"], recovered["previous_checkpoint"])

        audit = self.run_cli("audit")
        self.assertGreaterEqual(audit["metrics"]["checkpoints"], 3)
        self.assertEqual("ok", audit["integrity"]["quick_check"])

    def test_operation_commands_do_not_echo_canonical_input(self) -> None:
        canonical = '{"remote":"origin","token":"cli-operation-secret"}'
        begin_process = subprocess.run(
            self.cli_argv(
                "operation",
                "begin",
                "--story",
                self.fixture.story_id,
                "--logical-step",
                "push",
                "--operation",
                "git.push",
                "--canonical-input",
                canonical,
            ),
            cwd=ROOT,
            env=self.fixture.environment,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=10,
        )
        self.assertEqual(0, begin_process.returncode, begin_process.stderr)
        self.assertNotIn("cli-operation-secret", begin_process.stdout)
        key = json.loads(begin_process.stdout)["operation_key"]

        finished = self.run_cli(
            "operation",
            "finish",
            "--key",
            key,
            "--state",
            "succeeded",
            "--observed-state",
            '{"committed":true,"remote_ref":"main"}',
            "--result-summary",
            "remote ref observed",
        )
        self.assertEqual("succeeded", finished["record"]["state"])
        shown = self.run_cli("operation", "show", "--key", key)
        self.assertEqual("main", shown["record"]["observed_state"]["remote_ref"])
        self.assertNotIn(
            b"cli-operation-secret", self.fixture.store.path.read_bytes()
        )


if __name__ == "__main__":
    unittest.main()
