from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "scripts"
FIXTURES = Path(__file__).resolve().parent / "fixtures"
WINDOWS_TMP = Path(tempfile.gettempdir())

if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from continuity.harness_bridge import state_database  # noqa: E402
from continuity.model import SCHEMA_VERSION  # noqa: E402
from continuity.store import ContinuityStore  # noqa: E402


class ContinuityFixture:
    story_id = "WIN-002"
    story_revision = "fixture-revision"
    plan_path = "docs/plans/completed/session-continuity-v1.md"

    def __init__(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(
            prefix="continuity-test-", dir=WINDOWS_TMP
        )
        self.state_root = Path(self.temporary.name) / "state"
        self.environment = {
            **os.environ,
            "CODEX_CONTINUITY_STATE_ROOT": str(self.state_root),
            "CODEX_CONTINUITY_HARNESS_TIMEOUT_MS": "120",
        }
        self.previous_state_root = os.environ.get("CODEX_CONTINUITY_STATE_ROOT")
        os.environ["CODEX_CONTINUITY_STATE_ROOT"] = str(self.state_root)
        self.store = ContinuityStore(state_database(ROOT))

    def close(self) -> None:
        if self.previous_state_root is None:
            os.environ.pop("CODEX_CONTINUITY_STATE_ROOT", None)
        else:
            os.environ["CODEX_CONTINUITY_STATE_ROOT"] = self.previous_state_root
        self.temporary.cleanup()

    def bind(self, session_id: str = "fixture-session") -> dict[str, Any]:
        return self.store.bind(
            session_id,
            self.story_id,
            self.story_revision,
            self.plan_path,
            explicit=True,
        )

    def checkpoint(
        self,
        session_id: str = "fixture-session",
        *,
        boundary: str = "Implementation and focused store tests are complete.",
        next_action: str = "Run the compact/resume hook fixture suite.",
        completed: list[str] | None = None,
        pending: list[str] | None = None,
        effects: list[str] | None = None,
        verification: dict[str, Any] | None = None,
        created_at: str | None = None,
    ) -> dict[str, Any]:
        self.bind(session_id)
        previous, _ = self.store.latest_valid(story_id=self.story_id)
        raw_latest = self.store.latest_raw_id(story_id=self.story_id)
        packet = {
            "schema_version": SCHEMA_VERSION,
            "session_id": session_id,
            "story_id": self.story_id,
            "story_revision": self.story_revision,
            "plan_path": self.plan_path,
            "git_head": "fixture-head",
            "worktree_status_hash": "0" * 64,
            "last_safe_boundary": boundary,
            "completed_operations": completed or ["store implemented"],
            "pending_operations": pending or ["hook proof"],
            "external_side_effects": effects or ["no external write observed"],
            "verification_state": verification or {"focused": "pending"},
            "next_action": next_action,
        }
        if created_at:
            packet["created_at"] = created_at
        return self.store.write_checkpoint(
            packet,
            expected_latest=raw_latest,
            previous_checkpoint=int(previous["id"]) if previous else None,
            event_type="fixture",
            create_backup=True,
        )

    def event(self, name: str, *, session_id: str = "fixture-session") -> dict[str, Any]:
        event = json.loads((FIXTURES / name).read_text(encoding="utf-8"))
        event["cwd"] = str(ROOT)
        event["session_id"] = session_id
        return event

    def run_hook(
        self, name: str, *, session_id: str = "fixture-session", environment=None
    ) -> subprocess.CompletedProcess[str]:
        event = self.event(name, session_id=session_id)
        return subprocess.run(
            [
                sys.executable,
                str(ROOT / "scripts" / "continuity_cli.py"),
                "--repo-root",
                str(ROOT),
                "hook",
            ],
            input=json.dumps(event),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=ROOT,
            env={**self.environment, **(environment or {})},
            timeout=5,
        )

    def run_lifecycle(
        self, name: str, *, session_id: str = "fixture-session", environment=None
    ) -> subprocess.CompletedProcess[str]:
        event = self.event(name, session_id=session_id)
        return subprocess.run(
            [
                sys.executable,
                str(ROOT / "scripts" / "continuity_cli.py"),
                "--repo-root",
                str(ROOT),
                "lifecycle",
            ],
            input=json.dumps(event),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=ROOT,
            env={**self.environment, **(environment or {})},
            timeout=5,
        )
