from __future__ import annotations

import json
import os
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Any, Callable

from .model import (
    CheckpointConflict,
    HumanDirectionRequired,
    InvalidCheckpoint,
    SCHEMA_VERSION,
    UnknownOperationOutcome,
    bounded_object,
    bounded_text,
    checkpoint_checksum,
    compact_json,
    normalize_checkpoint,
    utc_now,
    validated_checkpoint,
)

DDL = """
CREATE TABLE IF NOT EXISTS continuity_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS session_binding (
    session_id TEXT PRIMARY KEY,
    story_id TEXT NOT NULL,
    story_revision TEXT NOT NULL,
    plan_path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_binding_story ON session_binding(story_id);
CREATE TABLE IF NOT EXISTS checkpoint (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schema_version INTEGER NOT NULL,
    session_id TEXT NOT NULL,
    story_id TEXT NOT NULL,
    story_revision TEXT NOT NULL,
    plan_path TEXT NOT NULL,
    git_head TEXT NOT NULL,
    worktree_status_hash TEXT NOT NULL,
    last_safe_boundary TEXT NOT NULL,
    completed_operations TEXT NOT NULL,
    pending_operations TEXT NOT NULL,
    external_side_effects TEXT NOT NULL,
    verification_state TEXT NOT NULL,
    next_action TEXT NOT NULL,
    previous_checkpoint INTEGER,
    created_at TEXT NOT NULL,
    checksum TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_checkpoint_story ON checkpoint(story_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_checkpoint_session ON checkpoint(session_id, id DESC);
CREATE TABLE IF NOT EXISTS checkpoint_event (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    story_id TEXT,
    event_type TEXT NOT NULL,
    trigger_value TEXT,
    checkpoint_id INTEGER,
    outcome TEXT NOT NULL,
    detail TEXT NOT NULL,
    latency_ms INTEGER,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_event_story ON checkpoint_event(story_id, id DESC);
CREATE TABLE IF NOT EXISTS operation_ledger (
    operation_key TEXT PRIMARY KEY,
    story_id TEXT NOT NULL,
    logical_step_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    canonical_input_hash TEXT NOT NULL,
    state TEXT NOT NULL CHECK (
        state IN ('prepared','in_progress','unknown','succeeded','failed')
    ),
    observed_state TEXT NOT NULL,
    result_summary TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_operation_story ON operation_ledger(story_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS recovery_attempt (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    story_id TEXT,
    source TEXT NOT NULL,
    outcome TEXT NOT NULL,
    checkpoint_id INTEGER,
    detail TEXT NOT NULL,
    latency_ms INTEGER,
    created_at TEXT NOT NULL
);
"""

_JSON_FIELDS = {
    "completed_operations",
    "pending_operations",
    "external_side_effects",
    "verification_state",
}
_OPERATION_STATES = {"prepared", "in_progress", "unknown", "succeeded", "failed"}


class ContinuityStore:
    def __init__(self, path: Path, *, busy_timeout_ms: int = 250):
        if not path.is_absolute():
            raise ValueError("continuity database path must be absolute")
        self.path = path
        self.backup_path = path.with_suffix(path.suffix + ".backup")
        self.busy_timeout_ms = max(25, min(int(busy_timeout_ms), 2_000))

    def _connect(self, *, initialize: bool = True) -> sqlite3.Connection:
        if initialize:
            self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(
            self.path,
            timeout=self.busy_timeout_ms / 1_000,
            isolation_level=None,
        )
        connection.row_factory = sqlite3.Row
        connection.execute(f"PRAGMA busy_timeout={self.busy_timeout_ms}")
        connection.execute("PRAGMA foreign_keys=ON")
        if initialize:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.executescript(DDL)
            connection.execute(
                "INSERT OR IGNORE INTO continuity_metadata(key,value) VALUES('schema_version',?)",
                (str(SCHEMA_VERSION),),
            )
        return connection

    def bind(
        self,
        session_id: str,
        story_id: str,
        story_revision: str,
        plan_path: str,
        *,
        explicit: bool = False,
    ) -> dict[str, Any]:
        now = utc_now()
        with closing(self._connect()) as connection:
            connection.execute("BEGIN IMMEDIATE")
            current = connection.execute(
                "SELECT * FROM session_binding WHERE session_id=?", (session_id,)
            ).fetchone()
            if current and current["story_id"] != story_id and not explicit:
                connection.rollback()
                raise CheckpointConflict(
                    f"session {session_id} is already bound to {current['story_id']}"
                )
            if current:
                connection.execute(
                    """
                    UPDATE session_binding
                    SET story_id=?, story_revision=?, plan_path=?, updated_at=?,
                        version=version+1
                    WHERE session_id=?
                    """,
                    (story_id, story_revision, plan_path, now, session_id),
                )
            else:
                connection.execute(
                    """
                    INSERT INTO session_binding(
                        session_id,story_id,story_revision,plan_path,created_at,updated_at
                    ) VALUES(?,?,?,?,?,?)
                    """,
                    (session_id, story_id, story_revision, plan_path, now, now),
                )
            connection.commit()
        return self.binding(session_id) or {}

    def binding(self, session_id: str) -> dict[str, Any] | None:
        if not self.path.exists():
            return None
        with closing(self._connect(initialize=False)) as connection:
            row = connection.execute(
                "SELECT * FROM session_binding WHERE session_id=?", (session_id,)
            ).fetchone()
        return dict(row) if row else None

    def bindings(self) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        with closing(self._connect(initialize=False)) as connection:
            rows = connection.execute(
                "SELECT * FROM session_binding ORDER BY updated_at DESC, session_id"
            ).fetchall()
        return [dict(row) for row in rows]

    def _row_packet(self, row: sqlite3.Row) -> dict[str, Any]:
        packet = dict(row)
        for field in _JSON_FIELDS:
            packet[field] = json.loads(packet[field])
        return packet

    def latest_raw_id(
        self, *, story_id: str | None = None, session_id: str | None = None
    ) -> int | None:
        if not self.path.exists():
            return None
        clause, value = self._scope(story_id=story_id, session_id=session_id)
        with closing(self._connect(initialize=False)) as connection:
            row = connection.execute(
                f"SELECT id FROM checkpoint WHERE {clause} ORDER BY id DESC LIMIT 1",
                (value,),
            ).fetchone()
        return int(row["id"]) if row else None

    @staticmethod
    def _scope(
        *, story_id: str | None = None, session_id: str | None = None
    ) -> tuple[str, str]:
        if story_id:
            return "story_id=?", story_id
        if session_id:
            return "session_id=?", session_id
        raise ValueError("story_id or session_id is required")

    def latest_valid(
        self, *, story_id: str | None = None, session_id: str | None = None
    ) -> tuple[dict[str, Any] | None, int]:
        if not self.path.exists():
            return None, 0
        clause, value = self._scope(story_id=story_id, session_id=session_id)
        invalid = 0
        with closing(self._connect(initialize=False)) as connection:
            rows = connection.execute(
                f"SELECT * FROM checkpoint WHERE {clause} ORDER BY id DESC", (value,)
            ).fetchall()
        for row in rows:
            try:
                return validated_checkpoint(self._row_packet(row)), invalid
            except (InvalidCheckpoint, ValueError, TypeError, json.JSONDecodeError):
                invalid += 1
        return None, invalid

    def write_checkpoint(
        self,
        packet: dict[str, Any],
        *,
        expected_latest: int | None,
        previous_checkpoint: int | None = None,
        event_type: str = "checkpoint",
        trigger_value: str = "",
        fault: str | None = None,
        create_backup: bool = True,
    ) -> dict[str, Any]:
        candidate = dict(packet)
        candidate["previous_checkpoint"] = previous_checkpoint
        candidate["created_at"] = candidate.get("created_at") or utc_now()
        normalized = normalize_checkpoint(candidate)
        normalized["checksum"] = checkpoint_checksum(normalized)

        with closing(self._connect()) as connection:
            connection.execute("BEGIN IMMEDIATE")
            current_row = connection.execute(
                "SELECT id FROM checkpoint WHERE story_id=? ORDER BY id DESC LIMIT 1",
                (normalized["story_id"],),
            ).fetchone()
            actual_latest = int(current_row["id"]) if current_row else None
            if actual_latest != expected_latest:
                connection.rollback()
                raise CheckpointConflict(
                    f"checkpoint head changed: expected {expected_latest}, got {actual_latest}"
                )
            cursor = connection.execute(
                """
                INSERT INTO checkpoint(
                    schema_version,session_id,story_id,story_revision,plan_path,
                    git_head,worktree_status_hash,last_safe_boundary,
                    completed_operations,pending_operations,external_side_effects,
                    verification_state,next_action,previous_checkpoint,created_at,checksum
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    normalized["schema_version"],
                    normalized["session_id"],
                    normalized["story_id"],
                    normalized["story_revision"],
                    normalized["plan_path"],
                    normalized["git_head"],
                    normalized["worktree_status_hash"],
                    normalized["last_safe_boundary"],
                    compact_json(normalized["completed_operations"]),
                    compact_json(normalized["pending_operations"]),
                    compact_json(normalized["external_side_effects"]),
                    compact_json(normalized["verification_state"]),
                    normalized["next_action"],
                    normalized["previous_checkpoint"],
                    normalized["created_at"],
                    normalized["checksum"],
                ),
            )
            checkpoint_id = int(cursor.lastrowid)
            connection.execute(
                """
                INSERT INTO checkpoint_event(
                    session_id,story_id,event_type,trigger_value,checkpoint_id,
                    outcome,detail,created_at
                ) VALUES(?,?,?,?,?,'committed','',?)
                """,
                (
                    normalized["session_id"],
                    normalized["story_id"],
                    bounded_text(event_type, 80),
                    bounded_text(trigger_value, 80),
                    checkpoint_id,
                    utc_now(),
                ),
            )
            if fault == "after_insert":
                connection.rollback()
                raise sqlite3.OperationalError("injected checkpoint interruption")
            connection.commit()

        normalized["id"] = checkpoint_id
        if create_backup:
            try:
                self.online_backup()
                normalized["backup_state"] = "ok"
            except (OSError, sqlite3.Error):
                normalized["backup_state"] = "failed"
                self.record_event(
                    session_id=normalized["session_id"],
                    story_id=normalized["story_id"],
                    event_type="online-backup",
                    checkpoint_id=checkpoint_id,
                    outcome="backup-failed",
                    detail="committed checkpoint remains valid",
                )
        return normalized

    def online_backup(self) -> Path:
        temporary = self.backup_path.with_name(
            f"{self.backup_path.name}.tmp.{os.getpid()}"
        )
        if temporary.exists():
            temporary.unlink()
        try:
            with closing(self._connect(initialize=False)) as source:
                target = sqlite3.connect(temporary)
                try:
                    source.backup(target)
                    check = target.execute("PRAGMA integrity_check").fetchone()
                    if not check or check[0] != "ok":
                        raise sqlite3.DatabaseError("online backup integrity check failed")
                finally:
                    target.close()
            os.replace(temporary, self.backup_path)
        finally:
            if temporary.exists():
                temporary.unlink()
        return self.backup_path

    def record_event(
        self,
        *,
        session_id: str,
        story_id: str | None,
        event_type: str,
        trigger_value: str = "",
        checkpoint_id: int | None = None,
        outcome: str = "observed",
        detail: str = "",
        latency_ms: int | None = None,
    ) -> None:
        with closing(self._connect()) as connection:
            connection.execute(
                """
                INSERT INTO checkpoint_event(
                    session_id,story_id,event_type,trigger_value,checkpoint_id,
                    outcome,detail,latency_ms,created_at
                ) VALUES(?,?,?,?,?,?,?,?,?)
                """,
                (
                    bounded_text(session_id, 128),
                    bounded_text(story_id, 128) if story_id else None,
                    bounded_text(event_type, 80),
                    bounded_text(trigger_value, 80),
                    checkpoint_id,
                    bounded_text(outcome, 80),
                    bounded_text(detail, 500),
                    latency_ms,
                    utc_now(),
                ),
            )

    def record_recovery(
        self,
        *,
        session_id: str | None,
        story_id: str | None,
        source: str,
        outcome: str,
        checkpoint_id: int | None,
        detail: str = "",
        latency_ms: int | None = None,
    ) -> None:
        with closing(self._connect()) as connection:
            connection.execute(
                """
                INSERT INTO recovery_attempt(
                    session_id,story_id,source,outcome,checkpoint_id,detail,
                    latency_ms,created_at
                ) VALUES(?,?,?,?,?,?,?,?)
                """,
                (
                    bounded_text(session_id, 128) if session_id else None,
                    bounded_text(story_id, 128) if story_id else None,
                    bounded_text(source, 80),
                    bounded_text(outcome, 80),
                    checkpoint_id,
                    bounded_text(detail, 500),
                    latency_ms,
                    utc_now(),
                ),
            )

    def recover(self, *, session_id: str, story_id: str) -> dict[str, Any]:
        valid, invalid = self.latest_valid(story_id=story_id)
        if not valid:
            self.record_recovery(
                session_id=session_id,
                story_id=story_id,
                source="cli",
                outcome="missing",
                checkpoint_id=None,
                detail=f"invalid checkpoints: {invalid}",
            )
            raise InvalidCheckpoint("no valid checkpoint is available for recovery")
        raw_latest = self.latest_raw_id(story_id=story_id)
        recovered = dict(valid)
        recovered["session_id"] = session_id
        recovered["created_at"] = utc_now()
        result = self.write_checkpoint(
            recovered,
            expected_latest=raw_latest,
            previous_checkpoint=int(valid["id"]),
            event_type="recover",
            trigger_value="cli",
        )
        self.record_recovery(
            session_id=session_id,
            story_id=story_id,
            source="cli",
            outcome="recovered",
            checkpoint_id=int(result["id"]),
            detail=f"skipped invalid checkpoints: {invalid}",
        )
        return result

    def prepare_operation(
        self,
        *,
        key: str,
        story_id: str,
        logical_step_id: str,
        operation: str,
        canonical_input_hash: str,
    ) -> dict[str, Any]:
        now = utc_now()
        with closing(self._connect()) as connection:
            connection.execute("BEGIN IMMEDIATE")
            current = connection.execute(
                "SELECT * FROM operation_ledger WHERE operation_key=?", (key,)
            ).fetchone()
            if current:
                record = dict(current)
                identity = (
                    record["story_id"],
                    record["logical_step_id"],
                    record["operation"],
                    record["canonical_input_hash"],
                )
                expected = (
                    story_id,
                    logical_step_id,
                    operation,
                    canonical_input_hash,
                )
                if identity != expected:
                    connection.rollback()
                    raise CheckpointConflict("operation key identity mismatch")
                connection.commit()
                return self._operation_record(record)
            connection.execute(
                """
                INSERT INTO operation_ledger(
                    operation_key,story_id,logical_step_id,operation,
                    canonical_input_hash,state,observed_state,result_summary,
                    attempts,created_at,updated_at
                ) VALUES(?,?,?,?,?,'prepared','{}','',0,?,?)
                """,
                (
                    key,
                    story_id,
                    logical_step_id,
                    operation,
                    canonical_input_hash,
                    now,
                    now,
                ),
            )
            connection.commit()
        return self.operation(key) or {}

    def update_operation(
        self,
        key: str,
        *,
        state: str,
        observed_state: dict[str, Any] | None = None,
        result_summary: str = "",
        increment_attempt: bool = False,
    ) -> dict[str, Any]:
        if state not in _OPERATION_STATES:
            raise ValueError(f"invalid operation state: {state}")
        with closing(self._connect()) as connection:
            connection.execute("BEGIN IMMEDIATE")
            current = connection.execute(
                "SELECT * FROM operation_ledger WHERE operation_key=?", (key,)
            ).fetchone()
            if not current:
                connection.rollback()
                raise KeyError(f"operation not found: {key}")
            connection.execute(
                """
                UPDATE operation_ledger
                SET state=?, observed_state=?, result_summary=?,
                    attempts=attempts+?, updated_at=?
                WHERE operation_key=?
                """,
                (
                    state,
                    compact_json(bounded_object(observed_state or {})),
                    bounded_text(result_summary, 1_000),
                    1 if increment_attempt else 0,
                    utc_now(),
                    key,
                ),
            )
            connection.commit()
        return self.operation(key) or {}

    @staticmethod
    def _operation_record(record: dict[str, Any]) -> dict[str, Any]:
        result = dict(record)
        try:
            result["observed_state"] = json.loads(result["observed_state"])
        except (TypeError, json.JSONDecodeError):
            result["observed_state"] = {"state": "corrupt"}
        return result

    def operation(self, key: str) -> dict[str, Any] | None:
        if not self.path.exists():
            return None
        with closing(self._connect(initialize=False)) as connection:
            row = connection.execute(
                "SELECT * FROM operation_ledger WHERE operation_key=?", (key,)
            ).fetchone()
        return self._operation_record(dict(row)) if row else None

    def guarded_operation(
        self,
        *,
        key: str,
        story_id: str,
        logical_step_id: str,
        operation: str,
        canonical_input_hash: str,
        observe_target: Callable[[], dict[str, Any] | None],
        execute: Callable[[], Any],
    ) -> tuple[str, Any]:
        record = self.prepare_operation(
            key=key,
            story_id=story_id,
            logical_step_id=logical_step_id,
            operation=operation,
            canonical_input_hash=canonical_input_hash,
        )
        if record["state"] == "succeeded":
            return "reused", record

        observed = observe_target()
        if observed and observed.get("committed") is True:
            result = self.update_operation(
                key,
                state="succeeded",
                observed_state=observed,
                result_summary="target already committed; execution not repeated",
            )
            return "observed", result
        if record["state"] in {"in_progress", "unknown"}:
            raise HumanDirectionRequired(
                "operation outcome remains unknown; inspect the real target before retry"
            )

        self.update_operation(key, state="in_progress", increment_attempt=True)
        try:
            value = execute()
        except UnknownOperationOutcome:
            self.update_operation(
                key,
                state="unknown",
                result_summary="execution returned an unknown outcome",
            )
            raise
        except Exception:
            self.update_operation(
                key,
                state="failed",
                result_summary="execution failed before a successful observation",
            )
            raise
        result = self.update_operation(
            key,
            state="succeeded",
            observed_state={"committed": True},
            result_summary="execution completed and was observed",
        )
        return "executed", {"result": result, "value": value}

    def integrity(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "database": str(self.path),
            "exists": self.path.exists(),
            "quick_check": "missing",
            "valid_checkpoints": 0,
            "invalid_checkpoints": 0,
            "backup": {
                "path": str(self.backup_path),
                "exists": self.backup_path.exists(),
                "quick_check": "missing",
            },
        }
        if not self.path.exists():
            return result
        with closing(self._connect(initialize=False)) as connection:
            quick = connection.execute("PRAGMA quick_check").fetchone()
            result["quick_check"] = quick[0] if quick else "failed"
            rows = connection.execute("SELECT * FROM checkpoint ORDER BY id").fetchall()
        for row in rows:
            try:
                validated_checkpoint(self._row_packet(row))
                result["valid_checkpoints"] += 1
            except (InvalidCheckpoint, ValueError, TypeError, json.JSONDecodeError):
                result["invalid_checkpoints"] += 1
        if self.backup_path.exists():
            try:
                backup = sqlite3.connect(f"file:{self.backup_path}?mode=ro", uri=True)
                try:
                    quick = backup.execute("PRAGMA quick_check").fetchone()
                    result["backup"]["quick_check"] = quick[0] if quick else "failed"
                finally:
                    backup.close()
            except sqlite3.Error:
                result["backup"]["quick_check"] = "failed"
        return result

    def audit(self) -> dict[str, Any]:
        if not self.path.exists():
            return {
                "database": str(self.path),
                "bindings": 0,
                "checkpoints": 0,
                "events": {},
                "recoveries": {},
                "operations": {},
            }
        with closing(self._connect(initialize=False)) as connection:
            bindings = connection.execute(
                "SELECT count(*) FROM session_binding"
            ).fetchone()[0]
            checkpoints = connection.execute("SELECT count(*) FROM checkpoint").fetchone()[0]
            event_rows = connection.execute(
                "SELECT outcome,count(*) AS count FROM checkpoint_event GROUP BY outcome"
            ).fetchall()
            recovery_rows = connection.execute(
                "SELECT outcome,count(*) AS count FROM recovery_attempt GROUP BY outcome"
            ).fetchall()
            operation_rows = connection.execute(
                "SELECT state,count(*) AS count FROM operation_ledger GROUP BY state"
            ).fetchall()
            latest = connection.execute(
                "SELECT max(created_at) FROM checkpoint"
            ).fetchone()[0]
            lock_fallbacks = connection.execute(
                """
                SELECT count(*) FROM recovery_attempt
                WHERE detail LIKE '%lock-timeout%' OR outcome='lock-timeout-fallback'
                """
            ).fetchone()[0]
        return {
            "database": str(self.path),
            "bindings": int(bindings),
            "checkpoints": int(checkpoints),
            "latest_checkpoint_at": latest,
            "events": {row["outcome"]: int(row["count"]) for row in event_rows},
            "recoveries": {row["outcome"]: int(row["count"]) for row in recovery_rows},
            "operations": {row["state"]: int(row["count"]) for row in operation_rows},
            "lock_timeout_fallbacks": int(lock_fallbacks),
        }
