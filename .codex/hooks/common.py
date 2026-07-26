#!/data/data/com.termux/files/usr/bin/python3
from __future__ import annotations

import json
import os
import posixpath
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.gauntlet_policy import (  # noqa: E402
    PolicyContext,
    PolicyDecision,
    PolicyInput,
    decide,
    is_mutating_command,
    protected_path_for_target,
    protected_paths_in_text,
)


def read_event() -> dict[str, Any]:
    try:
        raw = sys.stdin.read()
        return json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        return {}


def command_text(event: dict[str, Any]) -> str:
    tool_input = event.get("tool_input") or {}
    if isinstance(tool_input, dict):
        for key in ("command", "patch"):
            value = tool_input.get(key)
            if isinstance(value, str):
                return value
        return json.dumps(tool_input, sort_keys=True)
    return str(tool_input)


def repo_root(event: dict[str, Any]) -> Path:
    cwd = Path(event.get("cwd") or os.getcwd()).resolve()
    try:
        top = subprocess.check_output(
            ["git", "rev-parse", "--show-toplevel"], cwd=cwd, text=True, stderr=subprocess.DEVNULL
        ).strip()
        return Path(top)
    except Exception:
        return cwd


def deny_pretool(reason: str) -> None:
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }))


def deny_permission(reason: str) -> None:
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PermissionRequest",
            "decision": {"behavior": "deny", "message": reason},
        }
    }))


def mentions_path(text: str, path: str) -> bool:
    normalized = text.replace("\\", "/")
    return path.rstrip("/") in normalized


def normalize_target(value: str) -> str:
    candidate = value.strip().strip("\"'").replace("\\", "/")
    while candidate.startswith("./"):
        candidate = candidate[2:]
    return posixpath.normpath(candidate)


def normalize_event_target(value: str, event: dict[str, Any]) -> str:
    candidate = Path(normalize_target(value))
    root = repo_root(event).resolve()
    cwd = Path(event.get("cwd") or root).resolve()
    resolved = candidate.resolve() if candidate.is_absolute() else (cwd / candidate).resolve()
    try:
        return resolved.relative_to(root).as_posix()
    except ValueError:
        return resolved.as_posix()


def patch_targets(text: str) -> set[str]:
    pattern = (
        r"(?m)^\*\*\* (?:Add|Update|Delete) File: (.+)$"
        r"|^\*\*\* Move to: (.+)$"
    )
    return {
        normalize_target(match.group(1) or match.group(2))
        for match in re.finditer(pattern, text)
    }


def mutation_targets(event: dict[str, Any]) -> set[str]:
    tool_name = str(event.get("tool_name") or "").lower()
    tool_input = event.get("tool_input") or {}
    if not isinstance(tool_input, dict):
        return set()
    patch = tool_input.get("patch")
    if tool_name == "apply_patch" or isinstance(patch, str):
        return {
            normalize_event_target(target, event)
            for target in patch_targets(
                patch if isinstance(patch, str) else command_text(event)
            )
        }
    if tool_name in {"edit", "write"}:
        return {
            normalize_event_target(value, event)
            for key in ("file_path", "path")
            if isinstance((value := tool_input.get(key)), str)
        }
    return set()


def protected_target(event: dict[str, Any] | str) -> str | None:
    if isinstance(event, dict):
        targets = mutation_targets(event)
        if targets:
            for target in targets:
                if protected := protected_path_for_target(target):
                    return protected
            return None
        text = command_text(event)
    else:
        text = event
    matches = protected_paths_in_text(text)
    return matches[0] if matches else None


def policy_input(event: dict[str, Any]) -> PolicyInput:
    tool_name = str(event.get("tool_name") or "").lower()
    tool_input = event.get("tool_input") or {}
    patch = tool_input.get("patch") if isinstance(tool_input, dict) else None
    if tool_name == "bash":
        operation = "shell"
    elif tool_name == "apply_patch" or isinstance(patch, str):
        operation = "patch"
    elif tool_name in {"edit", "write"}:
        operation = tool_name
    else:
        operation = "unknown"
    return PolicyInput(
        operation=operation,
        text=command_text(event),
        targets=tuple(sorted(mutation_targets(event))),
        authority_request=str(event.get("hook_event_name") or "").lower()
        == "permissionrequest",
    )


def policy_context(event: dict[str, Any]) -> PolicyContext:
    root = repo_root(event).resolve()
    return PolicyContext(
        cwd=Path(event.get("cwd") or root).resolve(),
        repo_root=root,
        maintenance_enabled=os.environ.get("CODEX_GAUNTLET_MAINTENANCE") == "1",
        maintenance_targets=tuple(
            target.strip()
            for target in os.environ.get(
                "CODEX_GAUNTLET_MAINTENANCE_TARGETS", ""
            ).split(",")
            if target.strip()
        ),
    )


def policy_decision(event: dict[str, Any]) -> PolicyDecision:
    return decide(policy_input(event), policy_context(event))


def maintenance_mutation_authorized(event: dict[str, Any]) -> bool:
    decision = policy_decision(event)
    return (
        decision.action == "requires_human"
        and decision.reason_code == "exact_maintenance_scope"
    )


def is_mutating(text: str) -> bool:
    return is_mutating_command(text)
