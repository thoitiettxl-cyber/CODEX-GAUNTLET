#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from gauntlet.handshake import policy_state
from gauntlet.security.contracts import (
    SEVERITIES,
    read_report,
    validate_agent_configuration_coverage,
    validate_scan_payload,
    verify_seal,
)
from gauntlet.security.export import validate_sarif
from gauntlet.security.history import load_active_triage
from gauntlet.security.threat_model import is_stale, load_threat_model


def _threshold_index(name: str) -> int:
    try:
        return SEVERITIES.index(name)
    except ValueError as exc:
        raise ValueError(f"invalid severity threshold: {name}") from exc


def latest_report(repo: Path) -> Path:
    pointer = repo / ".qa-artifacts" / "security-latest.json"
    if not pointer.exists():
        raise ValueError("security scan pointer missing")
    payload = json.loads(pointer.read_text(encoding="utf-8"))
    report = (repo / payload["reportDir"]).resolve()
    try:
        report.relative_to(repo.resolve())
    except ValueError as exc:
        raise ValueError("security report pointer escapes repository") from exc
    return report


def evaluate(report_dir: Path, repo: Path, *, expected_target_digest: str | None = None) -> list[str]:
    thresholds = json.loads((repo / "qa" / "security" / "thresholds.json").read_text(encoding="utf-8"))
    manifest, findings, coverage = read_report(report_dir)
    errors = validate_scan_payload(manifest, findings, coverage)
    errors.extend(verify_seal(report_dir))
    if "agentConfigurationAudit" not in coverage:
        errors.extend(validate_agent_configuration_coverage(None))

    if expected_target_digest and manifest.get("targetDigest") != expected_target_digest:
        errors.append("security report target digest does not match verification receipt target")
    if manifest.get("policyVersion") != policy_state(repo)["policyVersion"]:
        errors.append("security report policy version is stale")
    if manifest.get("revision") != manifest.get("target", {}).get("revision"):
        errors.append("security report revision/target mismatch")
    if manifest.get("provenance", {}).get("externalScanner") is not False:
        errors.append("external scanner provenance is prohibited")
    if manifest.get("provenance", {}).get("networkUsed") is not False:
        errors.append("network-backed security evidence is prohibited")

    current_model = load_threat_model(repo)
    if is_stale(repo, current_model) or manifest.get("threatModel", {}).get("stale") is True:
        errors.append("threat model is stale")
    if manifest.get("threatModelDigest") != current_model.inputDigest:
        errors.append("security report threat-model digest is stale")

    candidate_count = coverage.get("candidateCount", 0)
    validated_count = coverage.get("validatedCount", 0)
    completeness = 1.0 if candidate_count == 0 else validated_count / candidate_count
    if completeness < float(thresholds["validation_completeness_rate"]):
        errors.append(f"validation completeness {completeness:.3f} below threshold")

    high_count = coverage.get("highSeverityCount", 0)
    evidence_count = coverage.get("evidenceBackedHighSeverityCount", 0)
    evidence_rate = 1.0 if high_count == 0 else evidence_count / high_count
    if evidence_rate < float(thresholds["evidence_backed_high_severity_rate"]):
        errors.append(f"evidence-backed high severity rate {evidence_rate:.3f} below threshold")

    triage = load_active_triage(repo)
    threshold = _threshold_index(thresholds["fail_on_severity"])
    for finding in findings:
        severity = finding.get("severity", {}).get("level", "informational")
        if _threshold_index(severity) >= threshold and finding.get("state", "open") == "open":
            if finding.get("findingId") not in triage:
                errors.append(f"open {severity} finding blocks merge: {finding.get('findingId')}")

    sarif_path = report_dir / "results.sarif"
    if sarif_path.exists():
        errors.extend(validate_sarif(json.loads(sarif_path.read_text(encoding="utf-8"))))
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--report-dir")
    parser.add_argument("--latest", action="store_true")
    parser.add_argument("--target-digest")
    ns = parser.parse_args()
    try:
        report = Path(ns.report_dir).resolve() if ns.report_dir else latest_report(ROOT)
        errors = evaluate(report, ROOT, expected_target_digest=ns.target_digest)
    except Exception as exc:
        print(f"FAIL: security gate: {exc}", file=sys.stderr)
        return 2
    if errors:
        for error in errors:
            print(f"FAIL: security gate: {error}", file=sys.stderr)
        return 1
    print(f"PASS: security gate ({report.relative_to(ROOT)})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
