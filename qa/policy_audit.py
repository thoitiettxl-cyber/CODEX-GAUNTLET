#!/data/data/com.termux/files/usr/bin/python3
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def tracked_files() -> list[str]:
    try:
        return subprocess.check_output(["git", "ls-files"], cwd=ROOT, text=True, stderr=subprocess.DEVNULL).splitlines()
    except subprocess.CalledProcessError:
        return []


def changed_files() -> list[str]:
    paths = set()
    for command in (["git", "diff", "--name-only", "HEAD"], ["git", "diff", "--name-only", "--cached"]):
        try:
            paths.update(subprocess.check_output(command, cwd=ROOT, text=True, stderr=subprocess.DEVNULL).splitlines())
        except subprocess.CalledProcessError:
            pass
    return sorted(p for p in paths if p)


def main() -> int:
    errors = []
    tracked = tracked_files()
    changed = changed_files()

    forbidden_names = {".env", "id_rsa", "id_ed25519"}
    for path in tracked:
        if Path(path).name in forbidden_names or path.endswith((".pem", ".key")):
            errors.append(f"possible secret file committed: {path}")

    workflow = (ROOT / ".github" / "workflows" / "codex-gauntlet.yml").read_text()
    if "./qa/verify --mode ci" not in workflow:
        errors.append("CI workflow does not call canonical qa/verify --mode ci")
    if re.search(r"\b(?:curl|wget)\b.*(?:latest|repository-harness|raw\.githubusercontent)", workflow, re.I):
        errors.append("CI downloads Harness or latest remote content")

    agents = (ROOT / "AGENTS.md").read_text()
    if "./qa/verify" not in agents:
        errors.append("AGENTS.md does not point to qa/verify")
    if any(token in agents.lower() for token in ("coverage threshold", "mutation threshold", "hook json schema")):
        errors.append("AGENTS.md duplicates detailed verification policy")

    hooks = json.loads((ROOT / ".codex" / "hooks.json").read_text())
    required = {"PreToolUse", "PermissionRequest", "PostToolUse", "Stop"}
    missing = required - set(hooks.get("hooks", {}))
    if missing:
        errors.append(f"missing core hooks: {sorted(missing)}")
    for event, groups in hooks.get("hooks", {}).items():
        for group in groups:
            for handler in group.get("hooks", []):
                if handler.get("type") != "command":
                    errors.append(f"non-command hook handler configured for {event}")

    text_files = [p for p in tracked if p.endswith((".md", ".py", ".sh", ".json", ".yaml", ".yml", ".toml"))]
    audit_fixture_files = {"qa/policy_audit.py", "qa/selftest/run.py"}
    negation_markers = ("there is no", "do not", "must not", "never", "không", "forbid")
    for rel in text_files:
        if rel in audit_fixture_files:
            continue
        path = ROOT / rel
        try:
            lines = path.read_text(errors="ignore").splitlines()
        except Exception:
            continue
        for lineno, line in enumerate(lines, start=1):
            if not re.search(r"\bharness\s+verify\b", line, re.I):
                continue
            lowered = line.lower()
            if any(marker in lowered for marker in negation_markers):
                continue
            errors.append(f"parallel verification authority found in {rel}:{lineno}")

    harness_changed = any(p.startswith((".harness-core/", ".agents/skills/onboard-", ".agents/skills/audit-onboarding-")) or p == "scripts/bin/harness" for p in changed)
    if harness_changed and "qa/compatibility.json" not in changed:
        errors.append("Harness-managed files changed without compatibility baseline review")

    if errors:
        for error in errors:
            print(f"FAIL: {error}", file=sys.stderr)
        return 1
    print("PASS: policy audit")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
