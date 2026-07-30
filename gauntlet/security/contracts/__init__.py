from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from ..common import atomic_write_json, stable_digest, utc_now
from ..targets import NormalizedTarget

SEVERITIES = ("informational", "low", "medium", "high", "critical")
CONFIDENCES = ("low", "medium", "high")
DISPOSITIONS = ("reportable", "suppressed", "not_applicable", "deferred")
METHODS = ("reproduction", "focused_test", "trace", "static_only")
SAFE_ID = re.compile(r"^[a-z0-9][a-z0-9._:-]{7,127}$")
REQUIRED_ARTIFACTS = ("findings.json", "coverage.json", "validation.json", "report.md", "results.sarif")


@dataclass
class ValidationRecord:
    disposition: str
    method: str
    evidenceRefs: list[str]
    validatedAt: str
    proofGap: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class AttackPathRecord:
    entrypoint: str
    boundaryCrossings: list[str]
    controls: list[str]
    sink: str
    preconditions: list[str]
    impactSurface: str
    likelihood: str
    impact: str
    counterevidence: list[str] | None = None
    severityRationale: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def finding_id(rule_id: str, root_cause_key: str) -> str:
    return "gf-" + stable_digest([rule_id, root_cause_key])[:32]


def occurrence_id(stable_id: str, revision: str, path: str, start_line: int, end_line: int | None = None) -> str:
    return "go-" + stable_digest([stable_id, revision, path, str(start_line), str(end_line or start_line)])[:32]


def safe_location_path(value: str) -> bool:
    path = Path(value)
    return not path.is_absolute() and ".." not in path.parts and value not in ("", ".")


def materialize_finding(candidate: dict, validation: ValidationRecord, attack_path: AttackPathRecord | None, target: NormalizedTarget) -> dict:
    location = candidate["location"]
    stable = finding_id(candidate["ruleId"], candidate["rootCauseKey"])
    occurrence = occurrence_id(stable, target.revision, location["path"], location["startLine"], location.get("endLine"))
    return {
        "findingId": stable,
        "occurrenceId": occurrence,
        "ruleId": candidate["ruleId"],
        "title": candidate["title"],
        "severity": {"level": candidate["severity"], "rationale": attack_path.severityRationale if attack_path else "Pattern is retained below high severity pending validation."},
        "confidence": {"level": candidate["confidence"]},
        "state": "open",
        "locations": [location],
        "rootCause": {"summary": candidate["rootCauseSummary"], "evidenceRefs": candidate.get("evidenceRefs", [])},
        "validation": validation.to_dict(),
        "attackPath": attack_path.to_dict() if attack_path else None,
        "remediation": candidate.get("remediation"),
        "provenance": {"source": candidate.get("source", "gauntlet-security-clean-room"), "externalScanner": False, "networkUsed": False},
    }


def validate_validation(record: dict | None) -> list[str]:
    if not isinstance(record, dict):
        return ["validation record missing"]
    errors: list[str] = []
    if record.get("disposition") not in DISPOSITIONS:
        errors.append("invalid or missing validation disposition")
    if record.get("method") not in METHODS:
        errors.append("invalid or missing validation method")
    if not isinstance(record.get("evidenceRefs"), list):
        errors.append("validation evidenceRefs must be a list")
    if not record.get("validatedAt"):
        errors.append("validation validatedAt missing")
    if record.get("method") == "static_only" and not str(record.get("proofGap") or "").strip():
        errors.append("static_only validation requires proofGap")
    return errors


def validate_attack_path(record: dict | None) -> list[str]:
    if not isinstance(record, dict):
        return ["attackPath missing"]
    errors: list[str] = []
    for key in ("entrypoint", "sink", "impactSurface", "likelihood", "impact", "severityRationale"):
        if not str(record.get(key) or "").strip():
            errors.append(f"attackPath.{key} missing")
    if record.get("likelihood") not in ("low", "medium", "high"):
        errors.append("attackPath.likelihood invalid")
    if record.get("impact") not in ("low", "medium", "high"):
        errors.append("attackPath.impact invalid")
    for key in ("boundaryCrossings", "controls", "preconditions", "counterevidence"):
        if not isinstance(record.get(key), list):
            errors.append(f"attackPath.{key} must be a list")
    return errors


def validate_finding(finding: dict) -> list[str]:
    errors: list[str] = []
    for key in ("findingId", "occurrenceId"):
        value = finding.get(key)
        if not isinstance(value, str) or not SAFE_ID.fullmatch(value):
            errors.append(f"{key} invalid")
    severity = finding.get("severity", {})
    if severity.get("level") not in SEVERITIES:
        errors.append("severity invalid")
    if not str(severity.get("rationale") or "").strip():
        errors.append("severity rationale missing")
    if finding.get("confidence", {}).get("level") not in CONFIDENCES:
        errors.append("confidence invalid")
    locations = finding.get("locations")
    if not isinstance(locations, list) or not locations:
        errors.append("locations missing")
    else:
        for location in locations:
            if not safe_location_path(str(location.get("path", ""))):
                errors.append("location path traversal or absolute path")
            if not isinstance(location.get("startLine"), int) or location["startLine"] < 1:
                errors.append("location startLine invalid")
    errors.extend(validate_validation(finding.get("validation")))
    if severity.get("level") in ("high", "critical"):
        errors.extend(validate_attack_path(finding.get("attackPath")))
    provenance = finding.get("provenance", {})
    if provenance.get("externalScanner") is not False:
        errors.append("external scanner provenance is prohibited")
    if provenance.get("networkUsed") is not False:
        errors.append("network evidence is prohibited by default")
    return errors


def validate_scan_payload(manifest: dict, findings: list[dict], coverage: dict) -> list[str]:
    errors: list[str] = []
    for key in ("schemaVersion", "scanId", "targetDigest", "policyVersion", "threatModelDigest", "startedAt", "completedAt", "artifactDigests", "status", "revision", "target"):
        if key not in manifest:
            errors.append(f"manifest.{key} missing")
    if manifest.get("status") != "complete":
        errors.append("manifest status is not complete")
    if not isinstance(findings, list):
        errors.append("findings payload must be a list")
    else:
        for index, finding in enumerate(findings):
            errors.extend(f"finding[{index}]: {item}" for item in validate_finding(finding))
    for key in ("candidateCount", "validatedCount", "filesConsidered", "filesScanned", "filesParsed", "filesFallbackScanned", "unsupportedLanguageCount", "skippedGeneratedVendor"):
        if not isinstance(coverage.get(key), int) or coverage[key] < 0:
            errors.append(f"coverage.{key} invalid")
    if not isinstance(coverage.get("unsupportedFiles"), list):
        errors.append("coverage.unsupportedFiles must be a list")
    if not isinstance(coverage.get("untestedAttackSurfaces"), list):
        errors.append("coverage.untestedAttackSurfaces must be a list")
    if coverage.get("validatedCount") != len(findings):
        errors.append("coverage validatedCount does not equal findings length")
    return errors


def _report_text(scan_id: str, target: NormalizedTarget, findings: list[dict], coverage: dict) -> str:
    lines = [
        f"# Security scan {scan_id}", "", f"- Revision: `{target.revision}`", f"- Target: `{target.kind}`",
        f"- Files considered: {coverage['filesConsidered']}", f"- Files scanned: {coverage['filesScanned']}",
        f"- Unsupported: {coverage['unsupportedLanguageCount']}", f"- Candidates: {coverage['candidateCount']}",
        f"- Validated: {coverage['validatedCount']}", "", "## Findings", "",
    ]
    if findings:
        for finding in findings:
            lines.append(f"- **{finding['severity']['level']}** `{finding['findingId']}` — {finding['title']} ({finding['validation']['disposition']})")
    else:
        lines.append("No candidate findings were produced for this explicit target. This is not a claim that the repository is safe.")
    if coverage.get("untestedAttackSurfaces"):
        lines.extend(["", "## Proof gaps / unsupported surfaces", "", *[f"- {value}" for value in coverage["untestedAttackSurfaces"]]])
    return "\n".join(lines) + "\n"


def write_contracts(
    repo_root: str | Path,
    *,
    scan_id: str,
    target: NormalizedTarget,
    target_digest: str,
    policy_version: str,
    threat_model: dict,
    knowledge_base_digest: str,
    findings: list[dict],
    coverage: dict,
    started_at: str,
    phase: str = "full",
) -> Path:
    from ..export import export_sarif

    repo = Path(repo_root).resolve()
    report_dir = repo / "qa" / "security" / "reports" / scan_id
    if report_dir.exists():
        raise FileExistsError(f"append-only scan directory already exists: {scan_id}")
    report_dir.mkdir(parents=True)
    validation_payload = [{"findingId": item["findingId"], "validation": item["validation"]} for item in findings]
    atomic_write_json(report_dir / "findings.json", findings)
    atomic_write_json(report_dir / "coverage.json", coverage)
    atomic_write_json(report_dir / "validation.json", validation_payload)
    (report_dir / "report.md").write_text(_report_text(scan_id, target, findings, coverage), encoding="utf-8")
    export_sarif(report_dir / "results.sarif", findings)

    completed = utc_now()
    artifacts = {name: sha256_file(report_dir / name) for name in REQUIRED_ARTIFACTS}
    manifest = {
        "schemaVersion": "1",
        "scanId": scan_id,
        "targetDigest": target_digest,
        "policyVersion": policy_version,
        "threatModelDigest": threat_model.get("inputDigest", ""),
        **({"knowledgeBaseDigest": knowledge_base_digest} if knowledge_base_digest else {}),
        "startedAt": started_at,
        "completedAt": completed,
        "artifactDigests": artifacts,
        "status": "complete",
        "revision": target.revision,
        "target": target.to_dict(),
        "phase": phase,
        "threatModel": threat_model,
        "provenance": {"source": "codex-gauntlet-v6-clean-room", "externalScanner": False, "networkUsed": False},
    }
    errors = validate_scan_payload(manifest, findings, coverage)
    if errors:
        raise ValueError("invalid security contracts: " + "; ".join(errors))
    atomic_write_json(report_dir / "scan-manifest.json", manifest)
    # Read-only permissions are defense in depth; policy audit and digests remain authoritative.
    for path in report_dir.iterdir():
        if path.is_file():
            path.chmod(0o444)
    report_dir.chmod(0o555)
    return report_dir


def verify_seal(report_dir: str | Path) -> list[str]:
    path = Path(report_dir)
    errors: list[str] = []
    try:
        manifest = json.loads((path / "scan-manifest.json").read_text(encoding="utf-8"))
    except Exception as exc:
        return [f"cannot read scan manifest: {exc}"]
    digests = manifest.get("artifactDigests")
    if not isinstance(digests, dict):
        return ["manifest artifactDigests missing"]
    for name in REQUIRED_ARTIFACTS:
        artifact = path / name
        if not artifact.exists():
            errors.append(f"sealed artifact missing: {name}")
            continue
        if digests.get(name) != sha256_file(artifact):
            errors.append(f"sealed artifact digest mismatch: {name}")
    return errors


def read_report(report_dir: str | Path) -> tuple[dict, list[dict], dict]:
    path = Path(report_dir)
    manifest = json.loads((path / "scan-manifest.json").read_text(encoding="utf-8"))
    findings = json.loads((path / "findings.json").read_text(encoding="utf-8"))
    coverage = json.loads((path / "coverage.json").read_text(encoding="utf-8"))
    return manifest, findings, coverage
