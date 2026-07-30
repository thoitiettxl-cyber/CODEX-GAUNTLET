#!/usr/bin/env python
"""Final-diff policy and ownership audit for Codex Gauntlet v6."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEXT_SUFFIXES = (".md", ".py", ".ps1", ".json", ".yaml", ".yml", ".toml")


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
    for command in ("qa/verify.ps1 -Mode ci", "qa/verify.ps1 -Mode audit"):
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
    if "qa/verify.ps1" not in agents:
        errors.append("AGENTS.md does not point to qa/verify.ps1")
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
                for field in ("command", "commandWindows"):
                    command = str(handler.get(field) or "")
                    if not command.startswith("python "):
                        errors.append(f"non-Windows hook interpreter configured for {event}:{field}")

    compatibility = json.loads(_text("qa/compatibility.json"))
    if compatibility.get("codex", {}).get("platform") != "windows-native":
        errors.append("Codex compatibility must remain Windows-native")
    if "pi" in compatibility:
        errors.append("retired Pi compatibility remains active")
    harness = compatibility.get("repository_harness", {})
    if (
        harness.get("binary_mode") != "windows-release-core-source-cli"
        or harness.get("platform") != "x86_64-pc-windows-msvc"
        or harness.get("tested_core_semver") != "0.1.7"
        or harness.get("tested_cli_version") != "0.1.23"
    ):
        errors.append("Windows Harness compatibility baseline drifted")
    if (ROOT / ".pi").exists():
        errors.append("retired Pi adapter remains in the Windows repository")

    shared_policy = _text("scripts/gauntlet_policy.py")
    codex_common = _text(".codex/hooks/common.py")
    matrix = _text("qa/verify-matrix.yaml")
    classifier = _text("qa/classify_changes.py")
    verifier = _text("qa/verify_v6.py")
    wrapper = _text("qa/verify.ps1")
    if "from scripts.gauntlet_policy import" not in codex_common:
        errors.append("Codex adapter no longer delegates to shared policy")
    if "pi:" in matrix or '"pi"' in classifier:
        errors.append("retired Pi verification class remains active")

    if not wrapper.startswith("param("):
        errors.append("qa/verify.ps1 lacks the PowerShell entrypoint")
    if "qa/verify_v6.py" not in wrapper:
        errors.append("qa/verify.ps1 does not delegate to the v6 verifier")
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
        "config_audit",
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

    config_audit = _text("gauntlet/security/config_audit/audit.py")
    security_run = _text("gauntlet/security/run.py")
    security_contracts = _text("gauntlet/security/contracts/__init__.py")
    security_gates = _text("qa/security/gates.py")
    if "audit_agent_configuration" not in config_audit or "audit_agent_configuration" not in security_run:
        errors.append("agent configuration audit is outside the internal security pipeline")
    if not all(
        "agentConfigurationAudit" in content
        for content in (security_run, security_contracts, security_gates)
    ):
        errors.append("agent configuration audit lacks sealed coverage and gate enforcement")
    if any(
        token in config_audit
        for token in ("ecc-agentshield", "subprocess.run", "requests.", "urllib.request")
    ):
        errors.append("agent configuration audit depends on an external scanner or network runner")

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
        or path in {"AGENTS.md", "docs/HARNESS.md", "docs/WORKFLOW.md", "scripts/bin/harness.exe"}
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
