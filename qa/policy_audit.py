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
    pi_root = ROOT / ".pi"

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

    compatibility = json.loads((ROOT / "qa" / "compatibility.json").read_text())
    pi_compatibility = compatibility.get("pi", {})
    if (
        pi_compatibility.get("tested_version") != "0.82.1"
        or pi_compatibility.get("authority") != "auxiliary-only"
        or pi_compatibility.get("sandbox") is not False
        or pi_compatibility.get("verification_authority") is not False
    ):
        errors.append("Pi compatibility must remain pinned, auxiliary-only, and non-sandboxed")

    expected_pi_files = {
        ".pi/extensions/gauntlet/index.ts",
        ".pi/extensions/gauntlet/policy.ts",
        ".pi/extensions/gauntlet/verification.ts",
    }
    actual_pi_files = {
        path.relative_to(ROOT).as_posix()
        for path in pi_root.rglob("*")
        if path.is_file()
    } if pi_root.exists() else set()
    if actual_pi_files != expected_pi_files:
        errors.append(
            f"Pi adapter layout drift: expected={sorted(expected_pi_files)}, "
            f"actual={sorted(actual_pi_files)}"
        )

    forbidden_pi_paths = (
        pi_root / "SYSTEM.md",
        pi_root / "APPEND_SYSTEM.md",
        pi_root / "settings.json",
        pi_root / "package.json",
        pi_root / "package-lock.json",
        pi_root / "npm",
        pi_root / "node_modules",
        pi_root / "skills",
    )
    if any(path.exists() for path in forbidden_pi_paths):
        errors.append("Pi adapter may not shadow prompts, copy skills, or add packages")

    shared_policy = (ROOT / "scripts" / "gauntlet_policy.py").read_text()
    codex_common = (ROOT / ".codex" / "hooks" / "common.py").read_text()
    pi_policy = (pi_root / "extensions" / "gauntlet" / "policy.ts").read_text()
    pi_index = (pi_root / "extensions" / "gauntlet" / "index.ts").read_text()
    pi_verification = (
        pi_root / "extensions" / "gauntlet" / "verification.ts"
    ).read_text()
    pi_contract = (ROOT / "docs" / "product" / "pi-gauntlet.md").read_text()
    continuity_lifecycle = (
        ROOT / "scripts" / "continuity" / "lifecycle.py"
    ).read_text()
    pi_tests = (ROOT / "tests" / "pi" / "test_adapter.py").read_text()
    inventory = json.loads((ROOT / "docs" / "inventory" / "pi.json").read_text())
    matrix = (ROOT / "qa" / "verify-matrix.yaml").read_text()
    verify = (ROOT / "qa" / "verify").read_text()

    if '".pi/"' not in shared_policy or "from scripts.gauntlet_policy import" not in codex_common:
        errors.append("shared policy must protect Pi and remain the Codex decision source")
    if "scripts\", \"gauntlet_policy.py" not in pi_policy:
        errors.append("Pi adapter does not delegate to the shared decision core")
    if "not a sandbox" not in pi_index.lower() or "not a sandbox" not in pi_contract.lower():
        errors.append("Pi adapter must state its no-sandbox boundary")
    if (
        '"--mode", "stop"' not in pi_verification
        or "repairFollowUpSent" not in pi_verification
        or "failureSignature" not in pi_verification
    ):
        errors.append("Pi Stop verification or recursion guards are incomplete")
    pi_lifecycle_markers = (
        'pi.on("session_start"',
        'pi.on("session_before_compact"',
        'pi.on("session_compact"',
        'pi.on("session_shutdown"',
        '`pi:${nativeSessionId}`',
        '"lifecycle"',
        'deliverAs: "steer"',
        "triggerTurn: false",
    )
    if (
        not all(marker in pi_index for marker in pi_lifecycle_markers)
        or "class LifecycleOutcome" not in continuity_lifecycle
        or "def handle_lifecycle(" not in continuity_lifecycle
        or "protocol_version" not in continuity_lifecycle
    ):
        errors.append("Pi continuity lifecycle mapping or shared protocol is incomplete")
    if (
        "PiRuntimeContinuityTests" not in pi_tests
        or "pi.continuity-compaction-probe" not in pi_tests
        or "SessionStart/resume" not in pi_tests
        or not (
            ROOT / "tests" / "pi" / "fixtures" / "continuity-probe-session.jsonl"
        ).is_file()
    ):
        errors.append("Pi installed-runtime compaction/resume proof is incomplete")
    if "pi: [gauntlet-selftest, unit, integration, coverage]" not in matrix or "pi)" not in verify:
        errors.append("Pi changes do not select the declared verification matrix")
    if (
        inventory.get("authority") != "auxiliary-only"
        or inventory.get("verification_authority") is not False
        or inventory.get("continuity_protocol") != "session-continuity-v1"
    ):
        errors.append("Pi inventory must remain auxiliary-only")

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
