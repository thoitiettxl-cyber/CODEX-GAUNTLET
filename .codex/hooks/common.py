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

PROTECTED_PATHS = (
    ".codex/",
    ".harness-core/",
    ".agents/skills/onboard-repository/",
    ".agents/skills/audit-onboarding-proposal/",
    ".agents/skills/verify-suite/",
    ".agents/skills/spec-check/",
    ".agents/skills/mutation-audit/",
)
HARD_PROTECTED_PATHS = tuple(
    path
    for path in PROTECTED_PATHS
    if path == ".harness-core/" or path.startswith(".agents/skills/")
)
POLICY_CRITICAL = (
    "qa/thresholds.json",
    "qa/compatibility.json",
    "qa/verify-matrix.yaml",
    "qa/policy_audit.py",
    "qa/check_harness.py",
    ".github/workflows/codex-gauntlet.yml",
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


def target_matches(target: str, protected_path: str) -> bool:
    normalized = normalize_target(protected_path)
    return target == normalized or (
        protected_path.endswith("/") and target.startswith(normalized + "/")
    )


def protected_target(event: dict[str, Any] | str) -> str | None:
    if isinstance(event, dict):
        targets = mutation_targets(event)
        if targets:
            for target in targets:
                for path in PROTECTED_PATHS + POLICY_CRITICAL:
                    if target_matches(target, path):
                        return path
            return None
        text = command_text(event)
    else:
        text = event
    for path in PROTECTED_PATHS + POLICY_CRITICAL:
        if mentions_path(text, path):
            return path
    return None


def maintenance_mutation_authorized(event: dict[str, Any]) -> bool:
    if os.environ.get("CODEX_GAUNTLET_MAINTENANCE") != "1":
        return False
    tool_name = str(event.get("tool_name") or "").lower()
    if tool_name not in {"apply_patch", "edit", "write"}:
        return False
    targets = mutation_targets(event)
    allowed = {
        normalize_target(item)
        for item in os.environ.get("CODEX_GAUNTLET_MAINTENANCE_TARGETS", "").split(",")
        if item.strip()
    }
    if not targets or not targets <= allowed:
        return False
    return not any(
        target_matches(target, path)
        for target in targets
        for path in HARD_PROTECTED_PATHS
    )


def is_mutating(text: str) -> bool:
    signals = (
        "apply_patch", "cat >", "cat >>", "tee ", "sed -i", "perl -pi", "python -c",
        "rm ", "mv ", "cp ", "touch ", "chmod ", "chown ", "git checkout --", "git restore ",
    )
    lowered = text.lower()
    return any(s in lowered for s in signals) or "*** update file:" in lowered or "*** add file:" in lowered
