from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path
from typing import Any

from .harness_bridge import (
    HarnessUnavailable,
    git_snapshot,
    query_work_graph,
    resolve_binding,
    resolve_repo_root,
    state_database,
)
from .hook import run_hook
from .lifecycle import run_lifecycle
from .model import (
    ContinuityError,
    SCHEMA_VERSION,
    bounded_object,
    operation_key,
)
from .store import ContinuityStore


def _json_value(raw: str, *, object_only: bool = False) -> Any:
    value = json.loads(raw)
    if object_only and not isinstance(value, dict):
        raise argparse.ArgumentTypeError("value must be a JSON object")
    return value


def _emit(value: Any, *, pretty: bool = True) -> None:
    print(json.dumps(value, ensure_ascii=True, indent=2 if pretty else None, sort_keys=True))


def _store(args: argparse.Namespace) -> tuple[Path, ContinuityStore]:
    repo_root = resolve_repo_root(args.repo_root or Path.cwd())
    return repo_root, ContinuityStore(state_database(repo_root))


def command_status(args: argparse.Namespace) -> int:
    repo_root, store = _store(args)
    integrity = store.integrity()
    result: dict[str, Any] = {
        "repo_root": str(repo_root),
        "database": str(store.path),
        "integrity": integrity,
        "bindings": store.bindings(),
        "audit": store.audit(),
    }
    if args.session:
        binding = store.binding(args.session)
        result["binding"] = binding
        if binding:
            checkpoint, invalid = store.latest_valid(story_id=binding["story_id"])
            result["checkpoint"] = checkpoint
            result["invalid_newer_checkpoints"] = invalid
    try:
        graph = query_work_graph(repo_root)
        result["harness"] = {
            "revision": graph["revision"],
            "active_stories": [
                story["id"]
                for story in graph["stories"]
                if story.get("status") == "in_progress"
            ],
        }
    except HarnessUnavailable:
        result["harness"] = {"state": "unavailable"}
    _emit(result)
    return 0


def command_bind(args: argparse.Namespace) -> int:
    repo_root, store = _store(args)
    binding, degraded = resolve_binding(
        store,
        session_id=args.session,
        repo_root=repo_root,
        explicit_story=args.story,
        refresh_existing=False,
    )
    _emit({"binding": binding, "degraded": degraded})
    return 0


def command_checkpoint(args: argparse.Namespace) -> int:
    repo_root, store = _store(args)
    binding, degraded = resolve_binding(
        store,
        session_id=args.session,
        repo_root=repo_root,
        explicit_story=args.story,
        refresh_existing=False,
    )
    previous, invalid = store.latest_valid(story_id=binding["story_id"])
    raw_latest = store.latest_raw_id(story_id=binding["story_id"])
    git_head, status_hash = git_snapshot(repo_root)
    packet = {
        "schema_version": SCHEMA_VERSION,
        "session_id": args.session,
        "story_id": binding["story_id"],
        "story_revision": binding["story_revision"],
        "plan_path": binding["plan_path"],
        "git_head": git_head,
        "worktree_status_hash": status_hash,
        "last_safe_boundary": args.safe_boundary,
        "completed_operations": args.completed_operation,
        "pending_operations": args.pending_operation,
        "external_side_effects": args.external_side_effect,
        "verification_state": bounded_object(args.verification),
        "next_action": args.next_action,
    }
    checkpoint = store.write_checkpoint(
        packet,
        expected_latest=raw_latest,
        previous_checkpoint=int(previous["id"]) if previous else None,
        event_type="cli-checkpoint",
        trigger_value="explicit",
    )
    _emit(
        {
            "checkpoint": checkpoint,
            "invalid_newer_checkpoints": invalid,
            "degraded": degraded,
        }
    )
    return 0


def command_verify(args: argparse.Namespace) -> int:
    _, store = _store(args)
    result = store.integrity()
    _emit(result)
    healthy = (
        result["exists"]
        and result["quick_check"] == "ok"
        and result["invalid_checkpoints"] == 0
        and (
            not result["backup"]["exists"]
            or result["backup"]["quick_check"] == "ok"
        )
    )
    return 0 if healthy else 1


def command_recover(args: argparse.Namespace) -> int:
    repo_root, store = _store(args)
    binding = store.binding(args.session)
    if binding and not args.story:
        story_id = binding["story_id"]
    else:
        resolved, _ = resolve_binding(
            store,
            session_id=args.session,
            repo_root=repo_root,
            explicit_story=args.story,
            refresh_existing=False,
        )
        story_id = resolved["story_id"]
    recovered = store.recover(session_id=args.session, story_id=story_id)
    _emit({"recovered": recovered})
    return 0


def command_audit(args: argparse.Namespace) -> int:
    _, store = _store(args)
    _emit({"integrity": store.integrity(), "metrics": store.audit()})
    return 0


def command_operation_begin(args: argparse.Namespace) -> int:
    _, store = _store(args)
    key, input_hash = operation_key(
        args.story, args.logical_step, args.operation, args.canonical_input
    )
    record = store.prepare_operation(
        key=key,
        story_id=args.story,
        logical_step_id=args.logical_step,
        operation=args.operation,
        canonical_input_hash=input_hash,
    )
    _emit({"operation_key": key, "record": record})
    return 0


def command_operation_finish(args: argparse.Namespace) -> int:
    _, store = _store(args)
    record = store.update_operation(
        args.key,
        state=args.state,
        observed_state=args.observed_state,
        result_summary=args.result_summary,
    )
    _emit({"record": record})
    return 0


def command_operation_show(args: argparse.Namespace) -> int:
    _, store = _store(args)
    record = store.operation(args.key)
    if not record:
        _emit({"error": "operation not found", "operation_key": args.key})
        return 1
    _emit({"record": record})
    return 0


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(
        prog="scripts/windows-control.ps1 continuity",
        description="Compaction-aware local session continuity",
    )
    result.add_argument("--repo-root", help=argparse.SUPPRESS)
    commands = result.add_subparsers(dest="command", required=True)

    status = commands.add_parser("status")
    status.add_argument("--session")
    status.set_defaults(func=command_status)

    bind = commands.add_parser("bind")
    bind.add_argument("--session", required=True)
    bind.add_argument("--story", required=True)
    bind.set_defaults(func=command_bind)

    checkpoint = commands.add_parser("checkpoint")
    checkpoint.add_argument("--session", required=True)
    checkpoint.add_argument("--story")
    checkpoint.add_argument("--safe-boundary", required=True)
    checkpoint.add_argument("--next-action", required=True)
    checkpoint.add_argument("--completed-operation", action="append", default=[])
    checkpoint.add_argument("--pending-operation", action="append", default=[])
    checkpoint.add_argument("--external-side-effect", action="append", default=[])
    checkpoint.add_argument(
        "--verification",
        type=lambda raw: _json_value(raw, object_only=True),
        default={},
    )
    checkpoint.set_defaults(func=command_checkpoint)

    verify = commands.add_parser("verify")
    verify.set_defaults(func=command_verify)

    recover = commands.add_parser("recover")
    recover.add_argument("--session", required=True)
    recover.add_argument("--story")
    recover.set_defaults(func=command_recover)

    audit = commands.add_parser("audit")
    audit.set_defaults(func=command_audit)

    operation = commands.add_parser("operation")
    operation_commands = operation.add_subparsers(dest="operation_command", required=True)
    begin = operation_commands.add_parser("begin")
    begin.add_argument("--story", required=True)
    begin.add_argument("--logical-step", required=True)
    begin.add_argument("--operation", required=True)
    begin.add_argument("--canonical-input", required=True)
    begin.set_defaults(func=command_operation_begin)
    finish = operation_commands.add_parser("finish")
    finish.add_argument("--key", required=True)
    finish.add_argument(
        "--state",
        choices=["prepared", "in_progress", "unknown", "succeeded", "failed"],
        required=True,
    )
    finish.add_argument(
        "--observed-state",
        type=lambda raw: _json_value(raw, object_only=True),
        default={},
    )
    finish.add_argument("--result-summary", default="")
    finish.set_defaults(func=command_operation_finish)
    show = operation_commands.add_parser("show")
    show.add_argument("--key", required=True)
    show.set_defaults(func=command_operation_show)

    hook = commands.add_parser("hook")
    hook.set_defaults(func=lambda args: run_hook())
    lifecycle = commands.add_parser("lifecycle")
    lifecycle.set_defaults(func=lambda args: run_lifecycle())
    return result


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        return int(args.func(args))
    except (ContinuityError, HarnessUnavailable, OSError, sqlite3.Error, ValueError, KeyError) as exc:
        _emit({"error": str(exc), "type": type(exc).__name__})
        return 1
