from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from tests.continuity.support import ROOT, WINDOWS_TMP, ContinuityFixture

from continuity.model import UnknownOperationOutcome, operation_key


def logical_graph_from_database(path: Path) -> dict:
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=1)
    connection.row_factory = sqlite3.Row
    try:
        stories = [
            dict(row)
            for row in connection.execute(
                """
                SELECT id,title,risk_lane,contract_doc,status,verify_command
                FROM story ORDER BY id
                """
            )
        ]
        dependencies = [
            {"blocker": row["blocks_story_id"], "blocked": row["story_id"]}
            for row in connection.execute(
                """
                SELECT story_id,blocks_story_id FROM story_dependency
                ORDER BY blocks_story_id,story_id
                """
            )
        ]
        hierarchy = [
            {"parent": row["parent_story_id"], "child": row["child_story_id"]}
            for row in connection.execute(
                """
                SELECT parent_story_id,child_story_id FROM story_hierarchy
                ORDER BY parent_story_id,child_story_id
                """
            )
        ]
    finally:
        connection.close()
    return {
        "stories": stories,
        "dependencies": dependencies,
        "hierarchy": hierarchy,
    }


class GameDayTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture = ContinuityFixture()

    def tearDown(self) -> None:
        self.fixture.close()

    def test_compact_corruption_new_session_and_unknown_side_effect(self) -> None:
        original = self.fixture.checkpoint(
            boundary="All implementation files are written and focused tests pass.",
            next_action="Run canonical targeted verification.",
            completed=["contract", "store", "hooks", "ledger", "CLI"],
            pending=["canonical verification", "story completion"],
            effects=["handoff commit 3201f00 observed on origin/main"],
            verification={"focused": "pass", "canonical": "pending"},
        )
        pre = self.fixture.run_hook("pre_compact_auto.json")
        self.assertEqual(0, pre.returncode, pre.stderr)
        newest = self.fixture.store.latest_raw_id(story_id=self.fixture.story_id)
        self.assertGreater(newest, original["id"])
        with closing(sqlite3.connect(self.fixture.store.path)) as connection, connection:
            connection.execute(
                "UPDATE checkpoint SET checksum='game-day-corrupt' WHERE id=?",
                (newest,),
            )

        post = json.loads(self.fixture.run_hook("post_compact_auto.json").stdout)
        self.assertIn(
            "All implementation files are written and focused tests pass.",
            post["systemMessage"],
        )
        self.assertIn(
            "Run canonical targeted verification.", post["systemMessage"]
        )

        new_session = "game-day-new-session"
        self.fixture.bind(new_session)
        resumed = json.loads(
            self.fixture.run_hook(
                "session_start_resume.json", session_id=new_session
            ).stdout
        )
        self.assertIn("WIN-002", resumed["systemMessage"])
        self.assertIn(self.fixture.plan_path, resumed["systemMessage"])

        key, input_hash = operation_key(
            self.fixture.story_id,
            "game-day-publish",
            "publish",
            {"artifact": "fixture"},
        )
        target = {"committed": False}
        calls: list[str] = []

        def observe():
            return {"committed": target["committed"], "artifact": "fixture"}

        def execute():
            calls.append("publish")
            target["committed"] = True
            raise UnknownOperationOutcome("game-day transport timeout")

        with self.assertRaises(UnknownOperationOutcome):
            self.fixture.store.guarded_operation(
                key=key,
                story_id=self.fixture.story_id,
                logical_step_id="game-day-publish",
                operation="publish",
                canonical_input_hash=input_hash,
                observe_target=observe,
                execute=execute,
            )
        outcome, _ = self.fixture.store.guarded_operation(
            key=key,
            story_id=self.fixture.story_id,
            logical_step_id="game-day-publish",
            operation="publish",
            canonical_input_hash=input_hash,
            observe_target=observe,
            execute=execute,
        )
        self.assertEqual("observed", outcome)
        self.assertEqual(["publish"], calls)

    def test_semantic_changeset_replay_matches_live_logical_graph(self) -> None:
        with tempfile.TemporaryDirectory(
            prefix="continuity-replay-", dir=WINDOWS_TMP
        ) as temporary:
            temp_root = Path(temporary)
            database = temp_root / "harness.db"
            environment = {
                **os.environ,
                "HARNESS_REPO_ROOT": str(ROOT),
                "HARNESS_DB_PATH": str(database),
            }
            rebuild = subprocess.run(
                [
                    str(ROOT / "scripts" / "bin" / "harness-cli.exe"),
                    "db",
                    "rebuild",
                    "--from",
                    str(ROOT / ".harness" / "changesets"),
                ],
                cwd=ROOT,
                env=environment,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=20,
            )
            self.assertEqual(0, rebuild.returncode, rebuild.stderr)
            replay = subprocess.run(
                [
                    str(ROOT / "scripts" / "bin" / "harness-cli.exe"),
                    "query",
                    "work-graph",
                    "--json",
                ],
                cwd=ROOT,
                env=environment,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=5,
            )
            self.assertEqual(0, replay.returncode, replay.stderr)
            replay_graph = json.loads(replay.stdout)["result"]
            replay_logical = {
                "stories": [
                    {
                        key: story.get(key)
                        for key in (
                            "id",
                            "title",
                            "risk_lane",
                            "contract_doc",
                            "status",
                            "verify_command",
                        )
                    }
                    for story in replay_graph["stories"]
                ],
                "dependencies": replay_graph["dependencies"],
                "hierarchy": replay_graph["hierarchy"],
            }
            live_logical = logical_graph_from_database(ROOT / "harness.windows.db")

        self.assertEqual(live_logical, replay_logical)
        matching = [
            story
            for story in replay_logical["stories"]
            if story["id"] == "WIN-002"
        ]
        self.assertEqual(1, len(matching))


if __name__ == "__main__":
    unittest.main()
