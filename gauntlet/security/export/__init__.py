from __future__ import annotations

import csv
import json
from pathlib import Path

from ..common import atomic_write_json


def export_json(path: str | Path, findings: list[dict]) -> Path:
    output = Path(path)
    atomic_write_json(output, findings)
    return output


def export_csv(path: str | Path, findings: list[dict]) -> Path:
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["findingId", "ruleId", "title", "severity", "confidence", "path", "line", "disposition"])
        writer.writeheader()
        for item in findings:
            loc = item["locations"][0]
            writer.writerow({
                "findingId": item["findingId"], "ruleId": item["ruleId"], "title": item["title"],
                "severity": item["severity"]["level"], "confidence": item["confidence"]["level"],
                "path": loc["path"], "line": loc["startLine"],
                "disposition": item["validation"]["disposition"],
            })
    return output


def export_sarif(path: str | Path, findings: list[dict]) -> Path:
    rules = {}
    results = []
    level_map = {"critical": "error", "high": "error", "medium": "warning", "low": "note", "informational": "note"}
    for item in findings:
        rules[item["ruleId"]] = {"id": item["ruleId"], "name": item["title"], "shortDescription": {"text": item["title"]}}
        locations = []
        for loc in item["locations"]:
            locations.append({"physicalLocation": {"artifactLocation": {"uri": loc["path"]}, "region": {"startLine": loc["startLine"], "endLine": loc.get("endLine", loc["startLine"])}}})
        results.append({"ruleId": item["ruleId"], "level": level_map[item["severity"]["level"]], "message": {"text": item["rootCause"]["summary"]}, "locations": locations, "fingerprints": {"gauntletFindingId": item["findingId"], "gauntletOccurrenceId": item["occurrenceId"]}})
    payload = {"version": "2.1.0", "$schema": "https://json.schemastore.org/sarif-2.1.0.json", "runs": [{"tool": {"driver": {"name": "Codex Gauntlet Security Intelligence", "rules": list(rules.values())}}, "results": results}]}
    output = Path(path)
    atomic_write_json(output, payload)
    return output


def validate_sarif(payload: dict) -> list[str]:
    errors = []
    if payload.get("version") != "2.1.0":
        errors.append("SARIF version must be 2.1.0")
    runs = payload.get("runs")
    if not isinstance(runs, list) or not runs:
        errors.append("SARIF runs missing")
    else:
        for run in runs:
            if not isinstance(run.get("tool", {}).get("driver", {}).get("name"), str):
                errors.append("SARIF tool driver name missing")
            if not isinstance(run.get("results"), list):
                errors.append("SARIF results must be a list")
    return errors
