from __future__ import annotations

import json
import sqlite3
import unittest
from contextlib import closing
from unittest import mock

from tests.continuity.support import ContinuityFixture

from continuity.harness_bridge import select_active_story
from continuity.model import (
    AmbiguousBinding,
    UnknownOperationOutcome,
    build_system_message,
    operation_key,
)


class StoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture = ContinuityFixture()

    def tearDown(self) -> None:
        self.fixture.close()

    def test_interrupted_write_preserves_previous_checkpoint(self) -> None:
        previous = self.fixture.checkpoint()
        packet = dict(previous)
        packet.pop("id")
        packet.pop("checksum")
        packet.pop("created_at")
        packet["last_safe_boundary"] = "This interrupted boundary must not commit."

        with self.assertRaises(sqlite3.OperationalError):
            self.fixture.store.write_checkpoint(
                packet,
                expected_latest=int(previous["id"]),
                previous_checkpoint=int(previous["id"]),
                fault="after_insert",
            )

        latest, invalid = self.fixture.store.latest_valid(
            story_id=self.fixture.story_id
        )
        self.assertEqual(previous["id"], latest["id"])
        self.assertEqual(0, invalid)
        self.assertEqual(previous["id"], self.fixture.store.latest_raw_id(
            story_id=self.fixture.story_id
        ))

    def test_corrupt_newest_checkpoint_falls_back_and_recovers_append_only(self) -> None:
        previous = self.fixture.checkpoint(boundary="Known good boundary.")
        newest = self.fixture.checkpoint(boundary="Newest boundary before corruption.")
        with closing(sqlite3.connect(self.fixture.store.path)) as connection, connection:
            connection.execute(
                "UPDATE checkpoint SET checksum='corrupt' WHERE id=?", (newest["id"],)
            )

        latest, invalid = self.fixture.store.latest_valid(
            story_id=self.fixture.story_id
        )
        self.assertEqual(previous["id"], latest["id"])
        self.assertEqual(1, invalid)

        recovered = self.fixture.store.recover(
            session_id="fixture-session", story_id=self.fixture.story_id
        )
        self.assertEqual(previous["id"], recovered["previous_checkpoint"])
        self.assertGreater(recovered["id"], newest["id"])
        integrity = self.fixture.store.integrity()
        self.assertEqual(1, integrity["invalid_checkpoints"])
        self.assertEqual("ok", integrity["quick_check"])

    def test_online_backup_failure_keeps_committed_checkpoint_valid(self) -> None:
        self.fixture.bind()
        packet = {
            "schema_version": 1,
            "session_id": "fixture-session",
            "story_id": self.fixture.story_id,
            "story_revision": self.fixture.story_revision,
            "plan_path": self.fixture.plan_path,
            "git_head": "fixture-head",
            "worktree_status_hash": "0" * 64,
            "last_safe_boundary": "Backup failure boundary.",
            "completed_operations": [],
            "pending_operations": ["retry online backup"],
            "external_side_effects": [],
            "verification_state": {"focused": "pending"},
            "next_action": "Inspect continuity audit.",
        }
        with mock.patch.object(
            self.fixture.store, "online_backup", side_effect=OSError("fixture")
        ):
            committed = self.fixture.store.write_checkpoint(
                packet,
                expected_latest=None,
                previous_checkpoint=None,
            )
        latest, invalid = self.fixture.store.latest_valid(
            story_id=self.fixture.story_id
        )
        self.assertEqual(committed["id"], latest["id"])
        self.assertEqual("failed", committed["backup_state"])
        self.assertEqual(0, invalid)
        self.assertEqual(
            1, self.fixture.store.audit()["events"].get("backup-failed", 0)
        )

    def test_secret_values_are_redacted_from_packet_output_and_database(self) -> None:
        secret_a = "fixture-super-secret-token"
        secret_b = "sk-fixtureSecretValue123456"
        checkpoint = self.fixture.checkpoint(
            boundary=f"api_key={secret_a}",
            next_action=f"Use Authorization: Bearer {secret_a}",
            effects=[f"password={secret_a}", secret_b],
            verification={"cookie": secret_a},
        )
        message = build_system_message(checkpoint, source="fixture")
        database_bytes = self.fixture.store.path.read_bytes()
        backup_bytes = self.fixture.store.backup_path.read_bytes()
        for secret in (secret_a, secret_b):
            self.assertNotIn(secret, message)
            self.assertNotIn(secret.encode(), database_bytes)
            self.assertNotIn(secret.encode(), backup_bytes)
        self.assertIn("[REDACTED]", message)

    def test_same_operation_key_does_not_repeat_committed_fake_side_effect(self) -> None:
        key, input_hash = operation_key(
            self.fixture.story_id,
            "push-final",
            "git.push",
            {"remote": "origin", "ref": "main"},
        )
        target = {"committed": False}
        executions: list[str] = []

        def observe():
            return {"committed": target["committed"], "remote_ref": "fixture"}

        def execute():
            executions.append("push")
            target["committed"] = True
            raise UnknownOperationOutcome("transport timed out after target commit")

        with self.assertRaises(UnknownOperationOutcome):
            self.fixture.store.guarded_operation(
                key=key,
                story_id=self.fixture.story_id,
                logical_step_id="push-final",
                operation="git.push",
                canonical_input_hash=input_hash,
                observe_target=observe,
                execute=execute,
            )

        outcome, record = self.fixture.store.guarded_operation(
            key=key,
            story_id=self.fixture.story_id,
            logical_step_id="push-final",
            operation="git.push",
            canonical_input_hash=input_hash,
            observe_target=observe,
            execute=execute,
        )
        self.assertEqual("observed", outcome)
        self.assertEqual("succeeded", record["state"])
        self.assertEqual(["push"], executions)

    def test_multiple_active_stories_are_explicitly_ambiguous(self) -> None:
        graph = {
            "revision": "revision",
            "stories": [
                {"id": "TERMUX-002", "status": "in_progress"},
                {"id": "TERMUX-003", "status": "in_progress"},
            ],
        }
        with self.assertRaisesRegex(
            AmbiguousBinding, "TERMUX-002, TERMUX-003"
        ):
            select_active_story(graph)

    def test_operation_cli_never_persists_canonical_input(self) -> None:
        raw = {"token": "operation-secret", "remote": "origin"}
        key, input_hash = operation_key(
            self.fixture.story_id, "deploy", "external.api.write", raw
        )
        self.fixture.store.prepare_operation(
            key=key,
            story_id=self.fixture.story_id,
            logical_step_id="deploy",
            operation="external.api.write",
            canonical_input_hash=input_hash,
        )
        self.assertNotIn(b"operation-secret", self.fixture.store.path.read_bytes())
        record = self.fixture.store.operation(key)
        self.assertEqual(input_hash, record["canonical_input_hash"])
        self.assertEqual("prepared", record["state"])


if __name__ == "__main__":
    unittest.main()
