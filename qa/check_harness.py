#!/data/data/com.termux/files/usr/bin/python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROTECTED = (".codex/", "qa/", ".github/workflows/codex-gauntlet.yml")
EXPECTED_SKILLS = {
    "onboard-repository",
    "audit-onboarding-proposal",
    "verify-suite",
    "spec-check",
    "mutation-audit",
}
EXPECTED_CORE_PATHS = {
    ".agents/skills/audit-onboarding-proposal/SKILL.md",
    ".agents/skills/audit-onboarding-proposal/agents/openai.yaml",
    ".agents/skills/audit-onboarding-proposal/scripts/validate_evidence_capsule.py",
    ".agents/skills/onboard-repository/SKILL.md",
    ".agents/skills/onboard-repository/agents/openai.yaml",
    ".agents/skills/onboard-repository/references/evidence-capsule-v1.md",
    ".agents/skills/onboard-repository/references/evidence-capsule-v2.md",
    ".agents/skills/onboard-repository/scripts/emit_evidence_bundle.py",
    ".agents/skills/onboard-repository/scripts/render_patch.py",
    "AGENTS.md",
    "docs/WORKFLOW.md",
    "docs/README.md",
    "docs/product/README.md",
    "docs/plans/README.md",
    "docs/plans/active/README.md",
    "docs/plans/completed/README.md",
    "docs/decisions/README.md",
    "docs/templates/decision.md",
    "docs/templates/exec-plan.md",
}
EXPECTED_CLI_PATHS = (
    "docs/FEATURE_INTAKE.md",
    "docs/GLOSSARY.md",
    "docs/HARNESS_AUDIT.md",
    "docs/HARNESS_BACKLOG.md",
    "docs/HARNESS_COMPONENTS.md",
    "docs/HARNESS_MATURITY.md",
    "docs/IMPROVEMENT_PROTOCOL.md",
    "docs/TEST_MATRIX.md",
    "docs/TOOL_REGISTRY.md",
    "docs/TRACE_SPEC.md",
    "docs/contracts/harness-orchestration-v1.md",
    "docs/stories/README.md",
    "docs/stories/backlog.md",
    "docs/templates/spec-intake.md",
    "docs/templates/story.md",
    "docs/templates/validation-report.md",
    "docs/templates/high-risk-story/design.md",
    "docs/templates/high-risk-story/execplan.md",
    "docs/templates/high-risk-story/overview.md",
    "docs/templates/high-risk-story/validation.md",
    "scripts/bootstrap-harness.sh",
    "scripts/bootstrap-harness.ps1",
    "scripts/harness-cli-release-tag",
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return digest.hexdigest()


def fail(message: str) -> None:
    print(f"FAIL: {message}", file=sys.stderr)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-doctor-command", action="store_true")
    parser.add_argument("--skip-binary-execution", action="store_true")
    ns = parser.parse_args()
    errors = []
    try:
        manifest = json.loads((ROOT / ".harness-core" / "manifest.json").read_text())
        compat = json.loads((ROOT / "qa" / "compatibility.json").read_text())
    except Exception as exc:
        fail(f"cannot read compatibility/provenance: {exc}")
        return 2

    harness_compat = compat["repository_harness"]
    expected = harness_compat["tested_core_semver"]
    installed = manifest.get("core_version")
    if installed != expected:
        errors.append(f"Harness version mismatch: installed {installed}, expected {expected}")

    binary = ROOT / "scripts" / "bin" / "harness"
    if not binary.exists() or not os.access(binary, os.X_OK):
        errors.append("local Harness executable is missing or not executable")
    elif sha256(binary) != harness_compat["core_sha256"]:
        errors.append("local Harness executable checksum mismatch")

    cli = ROOT / "scripts" / "bin" / "harness-cli"
    if not cli.exists() or not os.access(cli, os.X_OK):
        errors.append("local harness-cli executable is missing or not executable")
    elif sha256(cli) != harness_compat["cli_sha256"]:
        errors.append("local harness-cli executable checksum mismatch")

    patch = ROOT / "scripts" / "patches" / "harness-cli-android-exclusive-lock.patch"
    if not patch.exists():
        errors.append("Android Harness CLI patch is missing")
    elif sha256(patch) != harness_compat["android_patch_sha256"]:
        errors.append("Android Harness CLI patch checksum mismatch")
    else:
        result = subprocess.run(
            ["git", "apply", "--numstat", str(patch)],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        if result.returncode:
            errors.append("Android Harness CLI patch is not a valid Git patch")

    if len(EXPECTED_CLI_PATHS) != harness_compat["cli_payload_count"]:
        errors.append("Harness CLI expected payload count mismatch")
    else:
        missing_cli = [path for path in EXPECTED_CLI_PATHS if not (ROOT / path).is_file()]
        if missing_cli:
            errors.append(f"Harness CLI payload files missing: {missing_cli}")
        else:
            cli_manifest = "".join(
                f"{sha256(ROOT / path)}  {path}\n" for path in EXPECTED_CLI_PATHS
            ).encode()
            actual = hashlib.sha256(cli_manifest).hexdigest()
            if actual != harness_compat["cli_payload_manifest_sha256"]:
                errors.append("Harness CLI payload checksum mismatch")

    schemas = sorted((ROOT / "scripts" / "schema").glob("*.sql"))
    if len(schemas) != harness_compat["schema_count"]:
        errors.append("Harness CLI schema bundle count mismatch")
    else:
        schema_manifest = "".join(
            f"{sha256(path)}  {path.relative_to(ROOT).as_posix()}\n" for path in schemas
        ).encode()
        actual = hashlib.sha256(schema_manifest).hexdigest()
        if actual != harness_compat["schema_manifest_sha256"]:
            errors.append("Harness CLI schema bundle checksum mismatch")

    owned = manifest.get("files", [])
    owned_paths = [entry.get("path") for entry in owned]
    if len(owned_paths) != len(set(owned_paths)):
        errors.append("Harness core manifest contains duplicate paths")
    if len(EXPECTED_CORE_PATHS) != harness_compat["core_payload_count"]:
        errors.append("Harness core expected payload count mismatch")
    if set(owned_paths) != EXPECTED_CORE_PATHS:
        missing_core = sorted(EXPECTED_CORE_PATHS - set(owned_paths))
        extra_core = sorted(set(owned_paths) - EXPECTED_CORE_PATHS)
        errors.append(
            f"Harness core payload mismatch: missing={missing_core}, extra={extra_core}"
        )
    for entry in owned:
        path = entry["path"]
        expected_hash = entry["upstream_sha256"]
        normalized = path.replace("\\", "/")
        if any(normalized == prefix.rstrip("/") or normalized.startswith(prefix) for prefix in PROTECTED):
            errors.append(f"Harness ownership overlaps protected Gauntlet path: {path}")
            continue
        candidate = ROOT / ".harness-core" / "base" / path
        if not candidate.exists():
            errors.append(f"Harness baseline file missing: {path}")
        elif sha256(candidate) != expected_hash:
            errors.append(f"Harness baseline file hash mismatch: {path}")

    if (ROOT / ".harness-core" / "update" / "PENDING").exists():
        errors.append("interrupted Harness update is pending")
    if (ROOT / ".harness-core" / "update" / "CONFLICT").exists():
        errors.append("unresolved Harness update conflict exists")

    actual_skills = {p.parent.name for p in (ROOT / ".agents" / "skills").glob("*/SKILL.md")}
    missing = EXPECTED_SKILLS - actual_skills
    if missing:
        errors.append(f"missing expected skills: {sorted(missing)}")

    if binary.exists() and not ns.skip_binary_execution:
        result = subprocess.run(
            [str(binary), "--version"], cwd=ROOT, capture_output=True, text=True
        )
        if result.returncode or result.stdout.strip() != f"harness {expected}":
            errors.append("Harness executable version mismatch")

    if cli.exists() and not ns.skip_binary_execution:
        result = subprocess.run(
            [str(cli), "--version"], cwd=ROOT, capture_output=True, text=True
        )
        expected_cli = harness_compat["tested_cli_version"]
        if result.returncode or result.stdout.strip() != f"harness-cli {expected_cli}":
            errors.append("harness-cli executable version mismatch")

    if not ns.skip_doctor_command and not ns.skip_binary_execution and binary.exists():
        result = subprocess.run([str(binary), "doctor", "--directory", str(ROOT)], cwd=ROOT)
        if result.returncode:
            errors.append("harness doctor command failed")

    if errors:
        for error in errors:
            fail(error)
        return 1
    print(f"PASS: Harness integrity ({installed}, {harness_compat['binary_mode']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
