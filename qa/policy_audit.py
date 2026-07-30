#!/data/data/com.termux/files/usr/bin/python3
"""Final-diff policy and ownership audit for Codex Gauntlet v6."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEXT_SUFFIXES = (".md", ".py", ".sh", ".json", ".yaml", ".yml", ".toml")


def _git(*args: str) -> list[str]:
    proc = subprocess.run(
        ["git", *args],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    return proc.stdout.splitlines() if proc.returncode == 0 else []


def tracked_files() -> list[str]:
    return _git("ls-files")


def changed_files() -> list[str]:
    paths = set(_git("diff", "--name-only", "HEAD"))
    paths.update(_git("diff", "--name-only", "--cached"))
    paths.update(_git("ls-files", "--others", "--exclude-standard"))
    return sorted(path for path in paths if path)


def current_paths(tracked: list[str], changed: list[str]) -> list[str]:
    """Return Git-visible paths that still exist in the current worktree."""

    paths: list[str] = []
    for rel in sorted(set(tracked + changed)):
        candidate = ROOT / rel
        if candidate.exists() or candidate.is_symlink():
            paths.append(rel)
    return paths


def current_text_files(paths: list[str]) -> list[str]:
    """Return regular, non-symlink files that are safe for content inspection."""

    return [
        rel
        for rel in paths
        if (ROOT / rel).is_file() and not (ROOT / rel).is_symlink()
    ]


def _text(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8", errors="ignore")


def _negated(line: str) -> bool:
    lowered = line.lower()
    return any(
        marker in lowered
        for marker in (
            "there is no",
            "do not",
            "must not",
            "never",
            "không",
            "prohibit",
            "forbidden",
            "no `",
        )
    )


def _parallel_authority_errors(paths: list[str]) -> list[str]:
    errors: list[str] = []
    excluded = {
        "qa/policy_audit.py",
        "qa/selftest/run.py",
        "qa/selftest/v6.py",
        ".codex/hooks/pre_tool_use_policy.py",
    }
    patterns = (
        r"\bharness\s+verify\b",
        r"\bsecurity\s+verify\b",
        r"\bgauntlet-security\s+scan\b",
    )
    for rel in paths:
        path = ROOT / rel
        if (
            rel in excluded
            or not rel.endswith(TEXT_SUFFIXES)
            or not path.is_file()
            or path.is_symlink()
        ):
            continue
        content = _text(rel)
        negative_section = False
        in_fence = False
        fence_negated = False
        recent_nonempty: list[str] = []
        for lineno, line in enumerate(content.splitlines(), 1):
            stripped = line.strip()
            lowered = stripped.lower()
            if stripped.startswith("#") or stripped == "---":
                negative_section = False
            if lowered in {
                "không:",
                "không có:",
                "prohibited:",
                "forbidden:",
                "not allowed:",
            }:
                negative_section = True
            if stripped.startswith("```"):
                if not in_fence:
                    fence_negated = negative_section or any(
                        _negated(item) for item in recent_nonempty[-4:]
                    )
                in_fence = not in_fence
            contextual_negation = (
                negative_section
                or (in_fence and fence_negated)
                or _negated(line)
            )
            if any(re.search(pattern, line, re.I) for pattern in patterns) and not contextual_negation:
                errors.append(f"parallel verification authority found in {rel}:{lineno}")
            if stripped:
                recent_nonempty.append(line)
    return errors


def main() -> int:
    errors: list[str] = []
    tracked = tracked_files()
    changed = changed_files()
    current = current_paths(tracked, changed)
    visible = current_text_files(current)

    for rel in current:
        name = Path(rel).name
        if name in {".env", "id_ed25519", "id_rsa"} or rel.endswith((".pem", ".key")):
            errors.append(f"possible secret file committed: {rel}")

    workflow = _text(".github/workflows/codex-gauntlet.yml")
    for command in ("./qa/verify --mode ci", "./qa/verify --mode audit"):
        if command not in workflow:
            errors.append(f"CI does not invoke canonical command: {command}")
    if re.search(
        r"\b(?:curl|wget)\b.*(?:latest|repository-harness|raw\.githubusercontent)",
        workflow,
        re.I,
    ):
        errors.append("CI downloads moving Harness or remote policy content")
    if not all(
        path in workflow
        for path in (
            ".qa-artifacts",
            "artifacts/verification/receipts",
            "qa/security/reports",
        )
    ):
        errors.append("CI does not publish verification and security evidence")

    agents = _text("AGENTS.md")
    if "./qa/verify" not in agents:
        errors.append("AGENTS.md does not point to qa/verify")
    if any(
        token in agents.lower()
        for token in (
            "coverage threshold",
            "fail_on_severity",
            "hook json schema",
            "mutation threshold",
        )
    ):
        errors.append("AGENTS.md duplicates detailed machine policy")

    hooks = json.loads(_text(".codex/hooks.json"))
    required_hooks = {"PermissionRequest", "PostToolUse", "PreToolUse", "Stop"}
    if missing := required_hooks - set(hooks.get("hooks", {})):
        errors.append(f"missing core hooks: {sorted(missing)}")
    for event, groups in hooks.get("hooks", {}).items():
        for group in groups:
            for handler in group.get("hooks", []):
                if handler.get("type") != "command":
                    errors.append(f"non-command hook handler configured for {event}")
                command = str(handler.get("command") or "")
                if not command.startswith(
                    "/data/data/com.termux/files/usr/bin/python3 "
                ):
                    errors.append(f"non-Termux hook interpreter configured for {event}")

    compatibility = json.loads(_text("qa/compatibility.json"))
    pi = compatibility.get("pi", {})
    if (
        pi.get("tested_version") != "0.82.1"
        or pi.get("authority") != "auxiliary-only"
        or pi.get("sandbox") is not False
        or pi.get("verification_authority") is not False
    ):
        errors.append("Pi compatibility must remain pinned and auxiliary-only")
    harness = compatibility.get("repository_harness", {})
    if (
        harness.get("binary_mode") != "termux-source-build"
        or harness.get("tested_core_semver") != "0.1.7"
        or harness.get("tested_cli_version") != "0.1.23"
    ):
        errors.append("Android Harness compatibility baseline drifted")

    expected_pi = {
        ".pi/extensions/gauntlet/index.ts",
        ".pi/extensions/gauntlet/policy.ts",
        ".pi/extensions/gauntlet/verification.ts",
    }
    actual_pi = {
        path.relative_to(ROOT).as_posix()
        for path in (ROOT / ".pi").rglob("*")
        if path.is_file()
    }
    if actual_pi != expected_pi:
        errors.append(
            f"Pi adapter layout drift: expected={sorted(expected_pi)}, "
            f"actual={sorted(actual_pi)}"
        )

    shared_policy = _text("scripts/gauntlet_policy.py")
    codex_common = _text(".codex/hooks/common.py")
    pi_policy = _text(".pi/extensions/gauntlet/policy.ts")
    matrix = _text("qa/verify-matrix.yaml")
    classifier = _text("qa/classify_changes.py")
    verifier = _text("qa/verify_v6.py")
    wrapper = _text("qa/verify")
    if '".pi/"' not in shared_policy or "from scripts.gauntlet_policy import" not in codex_common:
        errors.append("shared normalized policy no longer protects Codex and Pi")
    if '"scripts", "gauntlet_policy.py"' not in pi_policy:
        errors.append("Pi adapter does not delegate to shared policy")
    if "pi:" not in matrix or '"pi"' not in classifier:
        errors.append("Pi changes lack an explicit v6 verification class")

    if not wrapper.startswith("#!/data/data/com.termux/files/usr/bin/bash"):
        errors.append("qa/verify lacks the Termux Bash entrypoint")
    if not (ROOT / "qa/verify").stat().st_mode & 0o111:
        errors.append("qa/verify is not executable")
    if "qa/verify_v6.py" not in wrapper:
        errors.append("qa/verify does not delegate to the v6 verifier")
    if '"qa/selftest/v6.py"' not in verifier:
        errors.append("v6 acceptance suite is outside the canonical verifier")
    for mode in ("audit", "ci", "stop", "targeted"):
        if mode not in verifier:
            errors.append(f"v6 verifier missing mode: {mode}")
    for marker in (
        "classification_payload",
        "select_gates",
        "seal_evidence_manifest",
        "issue_receipt",
        "qa/security/run_pipeline.py",
    ):
        if marker not in verifier:
            errors.append(f"v6 verifier missing authority marker: {marker}")
    if re.search(r"\b(?:create|transition).*story", verifier, re.I):
        errors.append("Gauntlet verifier mutates Harness lifecycle")

    if not all(
        rule in shared_policy
        for rule in (
            "CG.POLICY.DESTRUCTIVE_ROOT",
            "CG.POLICY.EXTERNAL_SCANNER",
            "CG.POLICY.PROTECTED_WRITE",
            "CG.POLICY.HARNESS_MAINTENANCE",
        )
    ):
        errors.append("shared policy lacks stable v6 rule IDs")
    if not all(
        field in shared_policy
        for field in ("rule=", "target=", "reason=", "remediation=")
    ):
        errors.append("policy decisions lack complete explanation fields")

    security_packages = {
        "attack_path",
        "contracts",
        "discovery",
        "export",
        "history",
        "kb",
        "targets",
        "threat_model",
        "validation",
    }
    for package in security_packages:
        if not (ROOT / "gauntlet/security" / package / "__init__.py").is_file():
            errors.append(f"security package missing: {package}")

    manifest_names = {
        "Cargo.toml",
        "package-lock.json",
        "package.json",
        "pnpm-lock.yaml",
        "pyproject.toml",
        "requirements.txt",
        "yarn.lock",
    }
    for rel in visible:
        if Path(rel).name not in manifest_names or rel.startswith("qa/fixtures/"):
            continue
        content = _text(rel)
        if "@openai/codex-security" in content or re.search(
            r"\bcodex-security\b", content
        ):
            errors.append(f"external security dependency found in {rel}")

    for rel in current:
        if rel.startswith("qa/security/reports/") and not rel.endswith(".gitkeep"):
            errors.append(f"runtime security report committed: {rel}")
        if rel.startswith("artifacts/verification/") and not rel.endswith(".gitkeep"):
            errors.append(f"runtime verification evidence committed: {rel}")
        if rel.startswith("artifacts/metrics/") and not rel.endswith(".gitkeep"):
            errors.append(f"runtime metrics committed: {rel}")

    commands = json.loads(_text("qa/project-commands.json"))
    if commands.get("application_present") is not True:
        errors.append("current consumer application surface was downgraded")
    for gate in ("acceptance", "build", "coverage", "integration", "mutation", "unit"):
        if not commands.get("commands", {}).get(gate):
            errors.append(f"consumer command missing for gate: {gate}")

    errors.extend(_parallel_authority_errors(visible))

    harness_changed = any(
        path.startswith(
            (
                ".agents/skills/audit-onboarding-",
                ".agents/skills/onboard-",
                ".harness-core/",
            )
        )
        or path in {"AGENTS.md", "docs/HARNESS.md", "docs/WORKFLOW.md", "scripts/bin/harness"}
        for path in changed
    )
    if harness_changed and "qa/compatibility.json" not in changed:
        errors.append("Harness-managed files changed without compatibility review")

    if errors:
        for error in errors:
            print(f"FAIL: {error}", file=sys.stderr)
        return 1
    print("PASS: policy audit")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
