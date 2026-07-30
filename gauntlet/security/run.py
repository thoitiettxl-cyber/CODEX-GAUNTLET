from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from gauntlet.handshake import compute_target_digest, policy_state

from .attack_path import analyze_attack_path
from .common import atomic_write_json, utc_now
from .contracts import materialize_finding, verify_seal, write_contracts
from .discovery import discover_candidates
from .kb import ingest_knowledge_base
from .targets import normalize_target
from .threat_model import is_stale, load_threat_model
from .validation import validate_candidate


def _security_docs(repo: Path) -> list[str]:
    candidates: list[str] = []
    for rel in ("AGENTS.md", "SECURITY.md", "docs/quality/SECURITY-GATE.md", "security/threat-model-sources.json"):
        if (repo / rel).is_file():
            candidates.append(rel)
    base = repo / "docs" / "security"
    if base.is_dir():
        for path in sorted(base.rglob("*")):
            if path.is_file():
                candidates.append(path.relative_to(repo).as_posix())
    return candidates


def _scan_id(revision: str, target_digest: str) -> str:
    forced = os.environ.get("GAUNTLET_SCAN_ID")
    if forced:
        return forced
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"{stamp}-{revision[:10]}-{target_digest[:10]}"


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Internal Codex Gauntlet v6 security augmentation component")
    parser.add_argument("--repo", default=".")
    parser.add_argument("--mode", choices=["standard", "deep"], default="standard")
    parser.add_argument("--phase", choices=["fast", "full"], default="full")
    parser.add_argument("--verification-mode", choices=["targeted", "stop", "ci", "audit"], default="ci")
    parser.add_argument("--target-digest")
    parser.add_argument("--no-cache", action="store_true")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--repository", action="store_true")
    group.add_argument("--path", action="append", default=[])
    group.add_argument("--diff")
    group.add_argument("--working-tree", action="store_true")
    parser.add_argument("--base")
    parser.add_argument("--head")
    return parser.parse_args()


def _cache_pointer(repo: Path, digest: str) -> Path:
    return repo / ".qa-artifacts" / "security-cache" / f"{digest}.json"


def _reuse_cache(repo: Path, digest: str) -> dict | None:
    pointer = _cache_pointer(repo, digest)
    if not pointer.exists():
        return None
    try:
        payload = json.loads(pointer.read_text(encoding="utf-8"))
        report = (repo / payload["reportDir"]).resolve()
        report.relative_to(repo)
        manifest = json.loads((report / "scan-manifest.json").read_text(encoding="utf-8"))
        if manifest.get("targetDigest") != digest or verify_seal(report):
            return None
        latest = repo / ".qa-artifacts" / "security-latest.json"
        atomic_write_json(latest, {"scanId": manifest["scanId"], "reportDir": report.relative_to(repo).as_posix(), "targetDigest": digest, "reused": True})
        return {"phase": "full", "scanId": manifest["scanId"], "reportDir": str(report), "targetDigest": digest, "reused": True}
    except Exception:
        return None


def run(ns: argparse.Namespace) -> dict:
    repo = Path(ns.repo).resolve()
    target = normalize_target(repo, mode=ns.mode, repository=ns.repository, paths=ns.path, diff=ns.diff, working_tree=ns.working_tree, base=ns.base, head=ns.head)
    threat_model = load_threat_model(repo)
    stale = is_stale(repo, threat_model)
    kb_paths = _security_docs(repo)
    kb = ingest_knowledge_base(repo, kb_paths) if kb_paths else None
    target_digest = ns.target_digest or compute_target_digest(
        repo,
        paths=target.paths,
        mode=ns.verification_mode,
        threat_model_digest=threat_model.inputDigest,
        knowledge_base_digest=kb.digest if kb else "",
    )
    candidates, coverage_base = discover_candidates(repo, target, threat_model.to_dict(), kb.text if kb else "")

    if ns.phase == "fast":
        payload = {
            "schemaVersion": "1",
            "phase": "fast",
            "targetDigest": target_digest,
            "target": target.to_dict(),
            "threatModel": {**threat_model.to_dict(), "stale": stale},
            "candidateCount": len(candidates),
            "candidates": candidates,
            "coverage": coverage_base,
            "completedAt": utc_now(),
        }
        output = repo / ".qa-artifacts" / "security-fast.json"
        atomic_write_json(output, payload)
        if stale:
            raise ValueError("threat model is stale for meaningful boundary inputs")
        return {"phase": "fast", "output": str(output), "candidateCount": len(candidates), "targetDigest": target_digest, "threatModelStale": stale}

    if stale:
        raise ValueError("threat model is stale for meaningful boundary inputs")
    if not ns.no_cache:
        cached = _reuse_cache(repo, target_digest)
        if cached:
            return cached

    started = utc_now()
    findings: list[dict] = []
    for candidate in candidates:
        validation = validate_candidate(repo, candidate, target)
        attack_path = analyze_attack_path(candidate, validation, threat_model.to_dict())
        findings.append(materialize_finding(candidate, validation, attack_path, target))

    coverage = {
        **coverage_base,
        "candidateCount": len(candidates),
        "validatedCount": len(findings),
        "highSeverityCount": sum(1 for item in findings if item["severity"]["level"] in ("high", "critical")),
        "evidenceBackedHighSeverityCount": sum(
            1 for item in findings
            if item["severity"]["level"] in ("high", "critical")
            and (item["validation"].get("evidenceRefs") or item["validation"].get("proofGap"))
        ),
    }
    scan_id = _scan_id(target.revision, target_digest)
    report_dir = write_contracts(
        repo,
        scan_id=scan_id,
        target=target,
        target_digest=target_digest,
        policy_version=policy_state(repo)["policyVersion"],
        threat_model={**threat_model.to_dict(), "stale": False},
        knowledge_base_digest=kb.digest if kb else "",
        findings=findings,
        coverage=coverage,
        started_at=started,
    )
    pointer = repo / ".qa-artifacts" / "security-latest.json"
    atomic_write_json(pointer, {"scanId": scan_id, "reportDir": report_dir.relative_to(repo).as_posix(), "targetDigest": target_digest, "reused": False})
    cache = _cache_pointer(repo, target_digest)
    atomic_write_json(cache, {"scanId": scan_id, "reportDir": report_dir.relative_to(repo).as_posix()})
    return {"phase": "full", "scanId": scan_id, "reportDir": str(report_dir), "candidateCount": len(candidates), "targetDigest": target_digest, "threatModelStale": False, "reused": False}


def main() -> int:
    ns = _parse_args()
    try:
        result = run(ns)
    except Exception as exc:
        print(f"FAIL: security augmentation: {exc}")
        return 1
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
