#!/data/data/com.termux/files/usr/bin/python3
from __future__ import annotations

import json
import os
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
        value = tool_input.get("command")
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


def protected_target(text: str) -> str | None:
    for path in PROTECTED_PATHS + POLICY_CRITICAL:
        if mentions_path(text, path):
            return path
    return None


def is_mutating(text: str) -> bool:
    signals = (
        "apply_patch", "cat >", "cat >>", "tee ", "sed -i", "perl -pi", "python -c",
        "rm ", "mv ", "cp ", "touch ", "chmod ", "chown ", "git checkout --", "git restore ",
    )
    lowered = text.lower()
    return any(s in lowered for s in signals) or "*** update file:" in lowered or "*** add file:" in lowered
