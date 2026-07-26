from __future__ import annotations

import json
import sqlite3
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .harness_bridge import (
    HarnessTimedOut,
    HarnessUnavailable,
    checkpoint_age_seconds,
    git_snapshot,
    resolve_binding,
    resolve_repo_root,
    state_database,
)
from .model import (
    AmbiguousBinding,
    BindingUnavailable,
    ContinuityError,
    SCHEMA_VERSION,
    bounded_text,
    build_system_message,
)
from .store import ContinuityStore

PROTOCOL_VERSION = 1
MAX_PROTOCOL_OUTPUT = 8_192
STALE_SECONDS = 24 * 60 * 60
DEFAULT_BOUNDARY = "No explicit safe boundary was recorded before compaction."
DEFAULT_NEXT_ACTION = (
    "Inspect the linked plan and worktree, then record an explicit continuity "
    "checkpoint before any consequential write."
)


@dataclass(frozen=True)
class LifecycleOutcome:
    event_name: str
    message: str | None = None
    degraded: bool = False
    continue_: bool = True

    def protocol_result(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "protocol_version": PROTOCOL_VERSION,
            "event": self.event_name or "unknown",
            "continue": self.continue_,
            "degraded": self.degraded,
        }
        if self.message:
            result["message"] = bounded_text(self.message, 7_000)
        return result

    def codex_hook_result(self) -> dict[str, Any]:
        if self.event_name == "SessionEnd":
            return {}
        result: dict[str, Any] = {"continue": self.continue_}
        if self.message:
            result["systemMessage"] = bounded_text(self.message, 7_000)
        return result


def _success(event_name: str, message: str | None = None) -> LifecycleOutcome:
    return LifecycleOutcome(event_name=event_name, message=message)


def _degraded(event_name: str, category: str) -> LifecycleOutcome:
    if event_name == "SessionEnd":
        return LifecycleOutcome(event_name=event_name, degraded=True)
    return LifecycleOutcome(
        event_name=event_name,
        message=(
            "Continuity recovery degraded "
            f"({bounded_text(category, 120)}). Inspect the linked Git plan, Harness "
            "work graph, continuity status, and real external targets before a "
            "consequential retry."
        ),
        degraded=True,
    )


def _packet_from_previous(
    previous: dict[str, Any] | None,
    *,
    session_id: str,
    binding: dict[str, Any],
    repo_root: Path,
) -> dict[str, Any]:
    git_head, status_hash = git_snapshot(repo_root)
    if previous:
        packet = dict(previous)
        packet.pop("id", None)
        packet.pop("checksum", None)
        packet["session_id"] = session_id
        packet["story_revision"] = binding["story_revision"]
        packet["plan_path"] = binding["plan_path"]
        packet["git_head"] = git_head
        packet["worktree_status_hash"] = status_hash
        packet.pop("created_at", None)
        return packet
    return {
        "schema_version": SCHEMA_VERSION,
        "session_id": session_id,
        "story_id": binding["story_id"],
        "story_revision": binding["story_revision"],
        "plan_path": binding["plan_path"],
        "git_head": git_head,
        "worktree_status_hash": status_hash,
        "last_safe_boundary": DEFAULT_BOUNDARY,
        "completed_operations": [],
        "pending_operations": [],
        "external_side_effects": [],
        "verification_state": {"state": "not observed"},
        "next_action": DEFAULT_NEXT_ACTION,
    }


def _rehydrate(
    store: ContinuityStore,
    *,
    event_name: str,
    session_id: str,
    binding: dict[str, Any],
    source: str,
    degraded: list[str],
) -> LifecycleOutcome:
    started = time.monotonic()
    packet, invalid = store.latest_valid(story_id=binding["story_id"])
    if invalid:
        degraded.append(f"skipped {invalid} invalid newer checkpoint(s)")
    if not packet:
        latency = int((time.monotonic() - started) * 1_000)
        store.record_recovery(
            session_id=session_id,
            story_id=binding["story_id"],
            source=source,
            outcome="missing",
            checkpoint_id=None,
            detail="no valid checkpoint",
            latency_ms=latency,
        )
        return _success(
            event_name,
            f"Continuity binding: {binding['story_id']} → {binding['plan_path']}. "
            "No valid checkpoint exists; inspect the plan and record a safe "
            "boundary before a consequential write.",
        )
    age = checkpoint_age_seconds(packet)
    if age is not None and age > STALE_SECONDS:
        degraded.append(f"checkpoint is stale ({age}s old)")
    packet = {
        **packet,
        "session_id": session_id,
        "story_revision": binding["story_revision"],
        "plan_path": binding["plan_path"],
    }
    latency = int((time.monotonic() - started) * 1_000)
    outcome = "degraded" if degraded else "rehydrated"
    detail = "; ".join(degraded)
    if any("lock-timeout" in item for item in degraded):
        outcome = "lock-timeout-fallback"
    store.record_recovery(
        session_id=session_id,
        story_id=binding["story_id"],
        source=source,
        outcome=outcome,
        checkpoint_id=int(packet["id"]),
        detail=detail,
        latency_ms=latency,
    )
    return LifecycleOutcome(
        event_name=event_name,
        message=build_system_message(packet, degraded=degraded, source=source),
        degraded=bool(degraded),
    )


def handle_lifecycle(event: dict[str, Any]) -> LifecycleOutcome:
    event_name = bounded_text(event.get("hook_event_name"), 80)
    session_id = bounded_text(event.get("session_id"), 128).strip()
    if not event_name or not session_id:
        return _degraded(event_name, "invalid lifecycle envelope")

    try:
        repo_root = resolve_repo_root(event.get("cwd") or Path.cwd())
        store = ContinuityStore(state_database(repo_root))

        if event_name == "SessionEnd":
            binding = store.binding(session_id)
            if binding:
                store.record_event(
                    session_id=session_id,
                    story_id=binding["story_id"],
                    event_type="SessionEnd",
                    trigger_value=bounded_text(event.get("reason") or "other", 80),
                    outcome="observed",
                )
            return _success(event_name)

        binding, degraded = resolve_binding(
            store,
            session_id=session_id,
            repo_root=repo_root,
            refresh_existing=True,
        )

        if event_name == "PreCompact":
            trigger = bounded_text(event.get("trigger") or "unknown", 80)
            previous, invalid = store.latest_valid(story_id=binding["story_id"])
            raw_latest = store.latest_raw_id(story_id=binding["story_id"])
            if invalid:
                degraded.append(f"skipped {invalid} invalid newer checkpoint(s)")
            packet = _packet_from_previous(
                previous,
                session_id=session_id,
                binding=binding,
                repo_root=repo_root,
            )
            committed = store.write_checkpoint(
                packet,
                expected_latest=raw_latest,
                previous_checkpoint=int(previous["id"]) if previous else None,
                event_type="PreCompact",
                trigger_value=trigger,
            )
            message = (
                f"Continuity checkpoint #{committed['id']} committed for "
                f"{binding['story_id']} ({trigger})."
            )
            if degraded:
                message += " " + "; ".join(degraded)
            return LifecycleOutcome(
                event_name=event_name,
                message=message,
                degraded=bool(degraded),
            )

        if event_name == "PostCompact":
            source = f"PostCompact/{bounded_text(event.get('trigger') or 'unknown', 40)}"
            return _rehydrate(
                store,
                event_name=event_name,
                session_id=session_id,
                binding=binding,
                source=source,
                degraded=degraded,
            )

        if event_name == "SessionStart":
            source_value = bounded_text(event.get("source") or "startup", 40)
            if source_value in {"resume", "compact"}:
                return _rehydrate(
                    store,
                    event_name=event_name,
                    session_id=session_id,
                    binding=binding,
                    source=f"SessionStart/{source_value}",
                    degraded=degraded,
                )
            message = (
                f"Continuity binding active: {binding['story_id']} → "
                f"{binding['plan_path']}."
            )
            if degraded:
                message += " " + "; ".join(degraded)
            return LifecycleOutcome(
                event_name=event_name,
                message=message,
                degraded=bool(degraded),
            )

        return _success(event_name)
    except AmbiguousBinding:
        return _degraded(event_name, "multiple active stories require explicit binding")
    except BindingUnavailable:
        return _degraded(event_name, "no exact session/story binding is available")
    except HarnessTimedOut:
        return _degraded(event_name, "Harness read reached its lock timeout")
    except HarnessUnavailable:
        return _degraded(event_name, "Harness read is unavailable")
    except (ContinuityError, OSError, sqlite3.Error, ValueError):
        return _degraded(event_name, "local continuity state is unavailable")


def read_lifecycle_event(stdin: Any = sys.stdin) -> dict[str, Any]:
    try:
        raw = stdin.read()
        event = json.loads(raw) if raw.strip() else {}
        return event if isinstance(event, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def run_lifecycle(stdin: Any = sys.stdin, stdout: Any = sys.stdout) -> int:
    outcome = handle_lifecycle(read_lifecycle_event(stdin))
    encoded = json.dumps(
        outcome.protocol_result(),
        ensure_ascii=False,
        separators=(",", ":"),
    )
    if len(encoded.encode("utf-8")) > MAX_PROTOCOL_OUTPUT:
        outcome = _degraded(outcome.event_name, "lifecycle output exceeded its bound")
        encoded = json.dumps(
            outcome.protocol_result(),
            ensure_ascii=False,
            separators=(",", ":"),
        )
    stdout.write(encoded + "\n")
    return 0
