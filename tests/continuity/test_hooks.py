from __future__ import annotations

import fcntl
import json
import sqlite3
import time
import unittest
from contextlib import closing
from unittest.mock import patch

from tests.continuity.support import ROOT, ContinuityFixture
from continuity.harness_bridge import HarnessUnavailable, bounded_process
from continuity.hook import handle_event


class HarnessBridgeTests(unittest.TestCase):
    def test_unlaunchable_harness_is_reported_unavailable(self) -> None:
        with self.assertRaisesRegex(HarnessUnavailable, "could not start"):
            bounded_process(
                [str(ROOT / "scripts" / "bin" / "missing-harness")],
                cwd=ROOT,
                timeout_seconds=0.1,
            )


class HookFixtureTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture = ContinuityFixture()
        self.checkpoint = self.fixture.checkpoint()

    def tearDown(self) -> None:
        self.fixture.close()

    @staticmethod
    def output(process) -> dict:
        if process.returncode != 0:
            raise AssertionError(
                f"hook failed rc={process.returncode} stderr={process.stderr!r}"
            )
        return json.loads(process.stdout) if process.stdout.strip() else {}

    def test_manual_and_auto_compaction_fixtures_restore_exact_context(self) -> None:
        for fixture_name in (
            "pre_compact_manual.json",
            "pre_compact_auto.json",
        ):
            with self.subTest(fixture=fixture_name):
                result = self.output(self.fixture.run_hook(fixture_name))
                self.assertTrue(result["continue"])
                self.assertIn("checkpoint #", result["systemMessage"])

        for fixture_name in (
            "post_compact_manual.json",
            "post_compact_auto.json",
        ):
            with self.subTest(fixture=fixture_name):
                result = self.output(self.fixture.run_hook(fixture_name))
                message = result["systemMessage"]
                self.assertIn("TERMUX-002", message)
                self.assertIn(self.fixture.plan_path, message)
                self.assertIn(
                    "Implementation and focused store tests are complete.", message
                )
                self.assertIn(
                    "Run the compact/resume hook fixture suite.", message
                )

    def test_session_start_sources_and_session_end_fixture(self) -> None:
        startup = self.output(
            self.fixture.run_hook("session_start_startup.json")
        )
        self.assertIn("Continuity binding active", startup["systemMessage"])

        for fixture_name in (
            "session_start_resume.json",
            "session_start_compact.json",
        ):
            with self.subTest(fixture=fixture_name):
                result = self.output(self.fixture.run_hook(fixture_name))
                self.assertIn("TERMUX-002", result["systemMessage"])
                self.assertIn(
                    "Run the compact/resume hook fixture suite.",
                    result["systemMessage"],
                )

        ended = self.fixture.run_hook("session_end_other.json")
        self.assertEqual(0, ended.returncode)
        self.assertEqual("", ended.stdout)
        self.assertGreaterEqual(
            self.fixture.store.audit()["events"].get("observed", 0), 1
        )

    def test_runtime_neutral_lifecycle_protocol_matches_codex_adapter(self) -> None:
        # Exercise both adapters against the same deterministic degraded
        # Harness state. Without a stable lock condition, the deliberately
        # short fixture timeout can let one subprocess refresh successfully
        # while the instrumented peer times out, which tests scheduler timing
        # rather than protocol parity.
        lock_path = ROOT / ".harness" / "epoch-transition" / "writer.lock"
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        with lock_path.open("a+b") as lock:
            acquired = False
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                acquired = True
            except BlockingIOError:
                pass
            try:
                neutral_process = self.fixture.run_lifecycle(
                    "post_compact_manual.json"
                )
                codex = self.output(
                    self.fixture.run_hook("post_compact_manual.json")
                )
            finally:
                if acquired:
                    fcntl.flock(lock, fcntl.LOCK_UN)

        self.assertEqual(0, neutral_process.returncode, neutral_process.stderr)
        neutral = json.loads(neutral_process.stdout)

        self.assertEqual(1, neutral["protocol_version"])
        self.assertEqual("PostCompact", neutral["event"])
        self.assertTrue(neutral["continue"])
        self.assertEqual(
            neutral["degraded"],
            "Degraded recovery:" in neutral["message"],
        )
        self.assertEqual(neutral["message"], codex["systemMessage"])
        self.assertLessEqual(len(neutral_process.stdout.encode("utf-8")), 8_192)

        ended = self.fixture.run_lifecycle("session_end_other.json")
        self.assertEqual(0, ended.returncode, ended.stderr)
        ended_result = json.loads(ended.stdout)
        self.assertEqual("SessionEnd", ended_result["event"])
        self.assertNotIn("message", ended_result)

    def test_harness_contract_refresh_supersedes_stale_checkpoint_plan(self) -> None:
        stale_plan = "docs/plans/active/session-continuity-v1.md"
        current_plan = "docs/plans/completed/session-continuity-v1.md"
        self.fixture.plan_path = stale_plan
        self.fixture.checkpoint(
            boundary="Checkpoint created before plan promotion.",
            next_action="Resume against the current Harness contract.",
        )
        self.fixture.plan_path = current_plan

        graph = {
            "revision": "current-harness-revision",
            "stories": [
                {
                    "id": self.fixture.story_id,
                    "status": "implemented",
                    "contract_doc": current_plan,
                }
            ],
        }
        with patch(
            "continuity.harness_bridge.query_work_graph", return_value=graph
        ):
            result = handle_event(self.fixture.event("session_start_resume.json"))

        self.assertIn(current_plan, result["systemMessage"])
        self.assertNotIn(stale_plan, result["systemMessage"])

    def test_missing_corrupt_and_stale_checkpoints_degrade_explicitly(self) -> None:
        missing_session = "missing-session"
        self.fixture.store.bind(
            missing_session,
            "TERMUX-MISSING",
            "fixture-revision",
            "docs/plans/active/missing.md",
            explicit=True,
        )
        missing = self.output(
            self.fixture.run_hook(
                "session_start_resume.json", session_id=missing_session
            )
        )
        self.assertIn("No valid checkpoint exists", missing["systemMessage"])

        corrupt = self.fixture.checkpoint(
            boundary="This newest packet will be corrupted.",
            next_action="This action must not be restored.",
        )
        with closing(sqlite3.connect(self.fixture.store.path)) as connection, connection:
            connection.execute(
                "UPDATE checkpoint SET checksum='bad' WHERE id=?", (corrupt["id"],)
            )
        fallback = self.output(
            self.fixture.run_hook("post_compact_manual.json")
        )
        self.assertIn(
            "Implementation and focused store tests are complete.",
            fallback["systemMessage"],
        )
        self.assertIn("skipped 1 invalid newer checkpoint", fallback["systemMessage"])
        self.assertNotIn("This action must not be restored", fallback["systemMessage"])

        self.fixture.store.recover(
            session_id="fixture-session", story_id=self.fixture.story_id
        )
        self.fixture.checkpoint(
            created_at="2020-01-01T00:00:00Z",
            boundary="Old but valid safe boundary.",
            next_action="Revalidate state before continuing.",
        )
        stale = self.output(
            self.fixture.run_hook("session_start_resume.json")
        )
        self.assertIn("checkpoint is stale", stale["systemMessage"])

    def test_secret_hook_fixture_and_transcript_are_never_persisted(self) -> None:
        result = self.output(
            self.fixture.run_hook("secret_bearing_resume.json")
        )
        serialized = json.dumps(result)
        database = self.fixture.store.path.read_bytes()
        for secret in (
            "fixture-event-secret",
            "fixture-password-secret",
            "transcript-secret",
        ):
            self.assertNotIn(secret, serialized)
            self.assertNotIn(secret.encode(), database)

    def test_hook_failure_degrades_without_blocking(self) -> None:
        result = self.output(
            self.fixture.run_hook(
                "session_start_resume.json",
                environment={"CODEX_CONTINUITY_STATE_ROOT": "relative-state"},
            )
        )
        self.assertTrue(result["continue"])
        self.assertIn("Continuity recovery degraded", result["systemMessage"])
        self.assertNotIn("relative-state", result["systemMessage"])

    def test_initial_harness_unavailability_degrades_without_blocking(self) -> None:
        event = self.fixture.event(
            "session_start_resume.json", session_id="unbound-session"
        )
        with patch(
            "continuity.harness_bridge.query_work_graph",
            side_effect=HarnessUnavailable("fixture unavailable"),
        ):
            result = handle_event(event)

        self.assertTrue(result["continue"])
        self.assertIn("Continuity recovery degraded", result["systemMessage"])
        self.assertNotIn("fixture unavailable", result["systemMessage"])

    def test_held_harness_writer_lock_uses_bounded_checkpoint_fallback(self) -> None:
        lock_path = ROOT / ".harness" / "epoch-transition" / "writer.lock"
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        with lock_path.open("a+b") as lock:
            acquired = False
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                acquired = True
            except BlockingIOError:
                # A nested story-completion proof already holds the same lock.
                pass
            started = time.monotonic()
            result = self.output(
                self.fixture.run_hook("session_start_resume.json")
            )
            elapsed = time.monotonic() - started
            if acquired:
                fcntl.flock(lock, fcntl.LOCK_UN)

        self.assertLess(elapsed, 2.0)
        self.assertIn(
            "Run the compact/resume hook fixture suite.",
            result["systemMessage"],
        )
        self.assertIn("lock-timeout", result["systemMessage"])
        self.assertGreaterEqual(
            self.fixture.store.audit()["lock_timeout_fallbacks"], 1
        )


if __name__ == "__main__":
    unittest.main()
