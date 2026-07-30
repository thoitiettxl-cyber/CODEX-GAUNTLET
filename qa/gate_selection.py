#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable

VALID_MODES = {"targeted", "stop", "ci", "audit"}
FUNCTIONAL_ORDER = [
    "docs",
    "build",
    "unit",
    "integration",
    "acceptance",
    "coverage",
    "migration",
    "mutation",
    "dependency-audit",
    "harness-integrity",
    "selftest",
    "policy-audit",
]


@dataclass(frozen=True)
class GateSelection:
    mode: str
    gates: list[str]
    securityProfile: str | None
    reasons: list[dict]
    conservative: bool


def select_gates(records: Iterable[dict], mode: str) -> GateSelection:
    if mode not in VALID_MODES:
        raise ValueError(f"invalid verification mode: {mode}")
    records = list(records)
    classes = {str(item.get("className")) for item in records}
    gates: set[str] = set()
    reasons: list[dict] = []
    security_sensitive = bool(
        classes & {"security-sensitive", "threat-model-source", "gauntlet-policy"}
    )
    conservative = "unknown-mixed" in classes

    # Every canonical invocation proves Harness integrity. CI/audit additionally
    # expose their mandatory self-test and policy audit in the machine-readable
    # selection rather than relying on hidden verifier behavior.
    gates.add("harness-integrity")
    if mode in {"ci", "audit"}:
        gates.update({"selftest", "policy-audit"})

    for record in records:
        for gate in record.get("selectedGates", []):
            if gate in {"threat-model-freshness"}:
                continue
            gates.add(gate)
        reasons.append({
            "ruleId": record.get("ruleId"),
            "path": record.get("path"),
            "className": record.get("className"),
            "evidence": record.get("evidence", []),
        })

    if "gauntlet-policy" in classes:
        gates.update({"selftest", "policy-audit"})
    if "harness-core" in classes:
        gates.update({"harness-integrity", "selftest", "policy-audit"})
    if conservative:
        gates.update({"docs", "build", "unit", "integration", "acceptance", "coverage", "selftest", "policy-audit"})

    security_profile: str | None = None
    if mode == "audit":
        security_profile = "security-audit-repository"
        gates.update({"docs", "build", "unit", "integration", "acceptance", "coverage", "selftest", "policy-audit", "security"})
    elif security_sensitive and mode in {"targeted", "stop"}:
        security_profile = "security-fast"
        gates.add("security")
    elif security_sensitive and mode == "ci":
        security_profile = "security-full-diff"
        gates.add("security")

    if mode == "stop":
        # Stop remains a fast proof surface: mutation and broad acceptance gates are CI concerns.
        gates.discard("mutation")
        if not conservative and "gauntlet-policy" not in classes and "harness-core" not in classes:
            gates.discard("acceptance")
            gates.discard("build")
    if mode == "targeted":
        gates.discard("mutation")

    ordered = [gate for gate in FUNCTIONAL_ORDER if gate in gates]
    if "security" in gates:
        ordered.append("security")
    return GateSelection(mode, ordered, security_profile, reasons, conservative)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--classification", required=True)
    parser.add_argument("--mode", required=True, choices=sorted(VALID_MODES))
    parser.add_argument("--output")
    ns = parser.parse_args()
    payload = json.loads(Path(ns.classification).read_text(encoding="utf-8"))
    selection = asdict(select_gates(payload.get("records", []), ns.mode))
    text = json.dumps(selection, indent=2, sort_keys=True) + "\n"
    if ns.output:
        Path(ns.output).write_text(text, encoding="utf-8")
    else:
        print(text, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
