from __future__ import annotations

from ..contracts import AttackPathRecord, ValidationRecord


def analyze_attack_path(candidate: dict, validation: ValidationRecord, threat_model: dict) -> AttackPathRecord | None:
    if candidate.get("severity") not in ("high", "critical"):
        return None
    boundaries = list(threat_model.get("trustBoundaries") or ["Untrusted input → repository runtime"])
    controls = ["workspace sandbox", "focused functional tests", "qa/verify security gate", "human review"]
    counter: list[str] = []
    if validation.method in {"static_only", "trace"}:
        counter.append("Exploitability is not reproduced; severity remains provisional and proof-gap-backed.")
    if candidate.get("confidence") != "high":
        counter.append("Discovery confidence is below high and requires focused validation before escalation.")
    likelihood = "medium" if counter else "high"
    rationale = f"Impact is high and likelihood is {likelihood}; assessment considers controls and {len(counter)} counterevidence item(s)."
    return AttackPathRecord(
        entrypoint=f"An attacker-controlled value reaches {candidate['location']['path']}",
        boundaryCrossings=boundaries[:4],
        controls=controls,
        sink=candidate["title"],
        preconditions=["The flagged value is attacker-influenced", "The affected code path is reachable"],
        impactSurface="Code execution, authorization, integrity or confidentiality within the application trust domain",
        likelihood=likelihood,
        impact="high",
        counterevidence=counter,
        severityRationale=rationale,
    )
