from __future__ import annotations

from pathlib import Path

from ..common import utc_now
from ..contracts import ValidationRecord
from ..targets import NormalizedTarget


def validate_candidate(repo_root: str | Path, candidate: dict, target: NormalizedTarget) -> ValidationRecord:
    repo = Path(repo_root).resolve()
    rel = candidate["location"]["path"]
    line = candidate["location"]["startLine"]
    evidence = [f"source:{rel}:{line}"]
    has_runtime = any((repo / name).exists() for name in ("pyproject.toml", "package.json", "Cargo.toml", "go.mod"))
    if has_runtime:
        return ValidationRecord(
            disposition="deferred",
            method="trace",
            evidenceRefs=evidence,
            proofGap="A project runtime exists, but this clean-room scaffold does not execute untrusted PoCs automatically; a focused human-reviewed reproduction is required.",
            validatedAt=utc_now(),
        )
    return ValidationRecord(
        disposition="deferred",
        method="static_only",
        evidenceRefs=evidence,
        proofGap="No declared application build/runtime is available; the candidate is retained with static evidence and must not be described as reproduced.",
        validatedAt=utc_now(),
    )
