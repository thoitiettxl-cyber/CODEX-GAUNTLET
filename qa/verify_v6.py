#!/data/data/com.termux/files/usr/bin/python3
"""Canonical Codex Gauntlet v6 verification authority."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
import time
from dataclasses import asdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from gauntlet.handshake import (  # noqa: E402
    acquire_receipt_issuer,
    compute_target_digest,
    final_diff_digest,
    issue_receipt,
    load_work_context,
    seal_evidence_manifest,
    sha256_file,
    utc_now,
)
from qa.classify_changes import (  # noqa: E402
    classification_payload,
    git_paths,
)
from qa.gate_selection import select_gates  # noqa: E402
from qa.metrics import emit_metrics  # noqa: E402

VALID_MODES = {"targeted", "stop", "ci", "audit"}
UNITTEST_FAILURE = re.compile(r"^FAILED(?: \(|$)", re.MULTILINE)
FUNCTIONAL_SCRIPTS = {
    "acceptance": "qa/run-acceptance.sh",
    "build": "qa/run-build.sh",
    "coverage": "qa/run-coverage.sh",
    "dependency-audit": "qa/run-build.sh",
    "integration": "qa/run-integration.sh",
    "migration": "qa/run-migration.sh",
    "mutation": "qa/run-mutation.sh",
    "unit": "qa/run-unit.sh",
}


class VerificationFailure(RuntimeError):
    pass


def _effective_exit_code(gate: str, output: str, exit_code: int) -> int:
    """Fail closed when stdlib trace masks a unittest SystemExit.

    ``python -m trace`` catches every ``SystemExit`` and exits zero, including
    the non-zero status emitted by a failed unittest suite. Coverage is the
    only configured gate using that wrapper, so bind the workaround narrowly
    to its captured output rather than trusting the wrapper status alone.
    """

    if gate == "coverage" and exit_code == 0 and UNITTEST_FAILURE.search(output):
        return 1
    return exit_code


def _git(*args: str) -> tuple[int, str]:
    proc = subprocess.run(
        ["git", *args],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    return proc.returncode, proc.stdout.strip()


def _canonical_ref(value: str | None) -> str | None:
    if not value or value.startswith("-"):
        return None
    proc = subprocess.run(
        ["git", "rev-parse", "--verify", f"{value}^{{commit}}"],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    return proc.stdout.strip() if proc.returncode == 0 else None


def _security_target_args(
    mode: str,
    base: str | None,
    paths: list[str],
) -> list[str]:
    if mode == "audit":
        return ["--repository"]
    if base:
        return ["--diff", f"{base}..HEAD"]
    status = subprocess.run(
        ["git", "status", "--porcelain", "--untracked-files=normal"],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    ).stdout.strip()
    if status:
        return ["--working-tree", "--base", "HEAD"]
    existing = [path for path in paths if (ROOT / path).exists()]
    if existing:
        result: list[str] = []
        for path in existing:
            result.extend(["--path", path])
        return result
    return ["--repository"]


def _project_proof_gaps(selected_gates: list[str]) -> list[str]:
    config = json.loads(
        (ROOT / "qa" / "project-commands.json").read_text(encoding="utf-8")
    )
    commands = config.get("commands", {})
    gaps: list[str] = []
    for gate in selected_gates:
        if gate not in FUNCTIONAL_SCRIPTS:
            continue
        configured_gate = "build" if gate == "dependency-audit" else gate
        configured = commands.get(configured_gate)
        if not configured:
            surface = "declared" if config.get("application_present") else "absent"
            gaps.append(
                f"application:{gate}:consumer command missing "
                f"(application surface {surface})"
            )
    return gaps


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


class EvidenceRunner:
    def __init__(self, invocation_id: str) -> None:
        self.invocation_id = invocation_id
        self.root = ROOT / ".qa-artifacts" / "evidence" / invocation_id
        self.root.mkdir(parents=True, exist_ok=False)
        self.records: list[dict[str, Any]] = []

    def run(
        self,
        gate: str,
        argv: list[str],
        *,
        env: dict[str, str] | None = None,
    ) -> None:
        ordinal = len(self.records) + 1
        safe_gate = "".join(
            character if character.isalnum() or character in "-_" else "-"
            for character in gate
        )
        log_path = self.root / f"{ordinal:02d}-{safe_gate}.log"
        started_at = utc_now()
        started = time.perf_counter()
        command_line = shlex.join(argv)
        output = ""
        exit_code = 127
        try:
            proc = subprocess.run(
                argv,
                cwd=ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                env={**os.environ, **(env or {})},
                errors="replace",
            )
            output = proc.stdout
            exit_code = _effective_exit_code(gate, output, proc.returncode)
            if exit_code != proc.returncode:
                output += (
                    "\nFAIL: coverage output reported a unittest failure "
                    "despite a zero trace exit status.\n"
                )
        except OSError as exc:
            output = f"{type(exc).__name__}: {exc}\n"
        duration_ms = round((time.perf_counter() - started) * 1000, 3)
        body = f"+ {command_line}\n{output}"
        log_path.write_text(body, encoding="utf-8")
        log_path.chmod(0o444)
        print(f"+ {command_line}")
        print(output, end="" if output.endswith("\n") or not output else "\n")
        record = {
            "gate": gate,
            "argv": argv,
            "exitCode": exit_code,
            "startedAt": started_at,
            "completedAt": utc_now(),
            "durationMs": duration_ms,
            "logPath": log_path.relative_to(ROOT).as_posix(),
            "logSha256": sha256_file(log_path),
        }
        self.records.append(record)
        if exit_code:
            raise VerificationFailure(
                f"gate {gate} failed ({exit_code}): {command_line}"
            )

    def internal_failure(self, gate: str, message: str) -> None:
        ordinal = len(self.records) + 1
        log_path = self.root / f"{ordinal:02d}-{gate}-failure.log"
        log_path.write_text(message.rstrip() + "\n", encoding="utf-8")
        log_path.chmod(0o444)
        self.records.append(
            {
                "gate": gate,
                "argv": ["internal", gate],
                "exitCode": 1,
                "startedAt": utc_now(),
                "completedAt": utc_now(),
                "durationMs": 0.0,
                "logPath": log_path.relative_to(ROOT).as_posix(),
                "logSha256": sha256_file(log_path),
            }
        )


def _classification_artifacts(mode: str, paths: list[str]) -> tuple[dict, dict]:
    classification = classification_payload(paths)
    selection = asdict(select_gates(classification["records"], mode))
    artifact_dir = ROOT / ".qa-artifacts"
    _write_json(artifact_dir / f"classification-{mode}.json", classification)
    _write_json(artifact_dir / f"gate-selection-{mode}.json", selection)
    return classification, selection


def _run_selected_gates(
    runner: EvidenceRunner,
    *,
    mode: str,
    base_revision: str | None,
    classification: dict,
    selection: dict,
    target_digest: str,
) -> str | None:
    selected = list(selection["gates"])
    cross_platform = os.environ.get("CODEX_GAUNTLET_CROSS_PLATFORM") == "1"
    harness_argv = [
        sys.executable,
        "qa/check_harness.py",
        "--skip-doctor-command",
    ]
    if cross_platform:
        harness_argv.append("--skip-binary-execution")
    runner.run("harness-integrity", harness_argv)

    if "selftest" in selected:
        runner.run(
            "selftest",
            [sys.executable, "qa/selftest/run.py", "--group", "all"],
        )
        runner.run(
            "v6-acceptance",
            [sys.executable, "qa/selftest/v6.py"],
        )
        runner.run(
            "selftest",
            [
                sys.executable,
                "-m",
                "unittest",
                "discover",
                "-s",
                "qa/tests",
                "-p",
                "test_*.py",
            ],
        )

    for gate in selected:
        if gate in {
            "harness-integrity",
            "policy-audit",
            "security",
            "selftest",
        }:
            continue
        if gate == "docs":
            runner.run(
                "docs",
                [
                    sys.executable,
                    "-m",
                    "compileall",
                    "-q",
                    ".codex/hooks",
                    "gauntlet",
                    "qa",
                    "scripts/gauntlet_handshake.py",
                    "scripts/gauntlet_policy.py",
                ],
            )
        elif gate in FUNCTIONAL_SCRIPTS:
            runner.run(gate, [FUNCTIONAL_SCRIPTS[gate]])

    security_report_id: str | None = None
    profile = selection.get("securityProfile")
    if profile:
        phase = "fast" if profile == "security-fast" else "full"
        target_args = _security_target_args(
            mode,
            base_revision,
            list(classification["paths"]),
        )
        runner.run(
            "security",
            [
                sys.executable,
                "qa/security/run_pipeline.py",
                "--phase",
                phase,
                "--verification-mode",
                mode,
                "--target-digest",
                target_digest,
                *target_args,
            ],
        )
        if phase == "full":
            pointer = json.loads(
                (ROOT / ".qa-artifacts" / "security-latest.json").read_text(
                    encoding="utf-8"
                )
            )
            security_report_id = str(pointer["scanId"])
            runner.run(
                "security",
                [
                    sys.executable,
                    "qa/security/gates.py",
                    "--latest",
                    "--target-digest",
                    target_digest,
                ],
            )

    if "policy-audit" in selected:
        runner.run("policy-audit", [sys.executable, "qa/policy_audit.py"])

    # Every pass receipt binds to a checked final diff, not merely the state
    # that happened to exist before the last selected gate.
    runner.run("final-state", ["git", "diff", "--check"])
    return security_report_id


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Codex Gauntlet v6 canonical verification authority"
    )
    parser.add_argument("--mode", choices=sorted(VALID_MODES), default="targeted")
    parser.add_argument(
        "--base",
        default=os.environ.get("CODEX_GAUNTLET_BASE") or None,
    )
    parser.add_argument("--work-context")
    ns = parser.parse_args()

    issuer = acquire_receipt_issuer(ROOT)
    runner = EvidenceRunner(issuer.invocationId)
    started_at = utc_now()
    started = time.perf_counter()
    result = "fail"
    error: str | None = None
    security_report_id: str | None = None
    work_context: dict[str, Any] | None = None
    proof_gaps: list[str] = []

    base_revision = _canonical_ref(ns.base)
    paths = git_paths(base_revision)
    classification, selection = _classification_artifacts(ns.mode, paths)
    diff_digest = final_diff_digest(ROOT, base=base_revision)
    target_digest = compute_target_digest(
        ROOT,
        paths=paths,
        mode=ns.mode,
        diff_digest=diff_digest,
        base_revision=base_revision,
    )

    try:
        if ns.base and not base_revision:
            raise VerificationFailure(f"invalid base revision: {ns.base}")
        if ns.work_context:
            work_context = load_work_context(
                ROOT,
                ns.work_context,
                requested_mode=ns.mode,
            )
            declared = set(work_context.get("scope", {}).get("changedPaths", []))
            actual = set(paths)
            if declared != actual:
                raise VerificationFailure(
                    "WorkContext changed paths do not match actual diff: "
                    f"declared={sorted(declared)} actual={sorted(actual)}"
                )
        proof_gaps.extend(_project_proof_gaps(list(selection["gates"])))
        security_report_id = _run_selected_gates(
            runner,
            mode=ns.mode,
            base_revision=base_revision,
            classification=classification,
            selection=selection,
            target_digest=target_digest,
        )
        result = "pass"
    except Exception as exc:
        error = str(exc)
        if not runner.records:
            runner.internal_failure("verification-bootstrap", error)
        print(f"FAIL: {error}", file=sys.stderr)

    elapsed_ms = round((time.perf_counter() - started) * 1000, 3)
    metric_path = emit_metrics(
        ROOT,
        {
            "mode": ns.mode,
            "durationMs": elapsed_ms,
            "classes": classification.get("classes", []),
            "selectedGates": selection.get("gates", []),
            "securityProfile": selection.get("securityProfile"),
            "result": result,
            "proofGapCount": len(proof_gaps),
            "commandCount": len(runner.records),
            "readOnlyFalseBlockRate": 0.0,
        },
    )
    print(f"Metrics: {metric_path.relative_to(ROOT)}")

    completed_at = utc_now()
    final_digest = final_diff_digest(ROOT, base=base_revision)
    evidence_path = seal_evidence_manifest(
        ROOT,
        issuer,
        mode=ns.mode,
        target_digest=target_digest,
        selected_gates=selection.get("gates", []),
        command_records=runner.records,
        result=result,
        proof_gaps=proof_gaps,
        final_diff_digest_value=final_digest,
        final_state_checked=(
            result == "pass"
            and any(record["gate"] == "final-state" for record in runner.records)
        ),
        started_at=started_at,
        completed_at=completed_at,
        base_revision=base_revision,
    )
    receipt_path = issue_receipt(
        ROOT,
        issuer,
        mode=ns.mode,
        paths=classification.get("paths", []),
        selected_gates=selection.get("gates", []),
        classification_records=[
            f"{item.get('ruleId')}:{item.get('className')}:{item.get('path')}"
            for item in classification.get("records", [])
        ],
        result=result,
        evidence_manifest_path=evidence_path,
        proof_gaps=proof_gaps,
        work_context=work_context,
        security_report_id=security_report_id,
        started_at=started_at,
        completed_at=completed_at,
        target_digest=target_digest,
        diff_digest=final_digest,
        base_revision=base_revision,
    )
    print(f"VerificationReceipt: {receipt_path.relative_to(ROOT)}")

    if result == "pass":
        print(
            f"PASS: qa/verify --mode {ns.mode} "
            f"({elapsed_ms:.1f} ms, proof_gaps={len(proof_gaps)})"
        )
        return 0
    if error:
        print(f"FAIL: qa/verify --mode {ns.mode}: {error}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
