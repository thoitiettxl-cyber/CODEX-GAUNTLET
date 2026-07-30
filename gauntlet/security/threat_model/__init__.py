from __future__ import annotations

import fnmatch
import hashlib
import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path

from ..common import current_revision, git, utc_now

FOOTER_RE = re.compile(r"<!-- gauntlet-threat-model\s*(\{.*?\})\s*-->", re.S)
DEPENDENCY_FILES = {
    "package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "pyproject.toml",
    "poetry.lock", "requirements.txt", "Cargo.toml", "Cargo.lock", "go.mod", "go.sum",
}


@dataclass
class ThreatModelRecord:
    repository: str
    version: str
    assets: list[str]
    trustBoundaries: list[str]
    attackerInputs: list[str]
    invariants: list[str]
    assumptions: list[str]
    generatedAt: str
    inputDigest: str
    sourcePath: str = "security/threat-model.md"

    def to_dict(self) -> dict:
        return asdict(self)


def _tracked_paths(repo: Path) -> list[str]:
    try:
        tracked = git(repo, "ls-files").splitlines()
        untracked = git(repo, "ls-files", "--others", "--exclude-standard", check=False).splitlines()
        return sorted(set(tracked + untracked))
    except ValueError:
        return sorted(path.relative_to(repo).as_posix() for path in repo.rglob("*") if path.is_file())


def _source_policy(repo: Path) -> dict:
    path = repo / "security" / "threat-model-sources.json"
    if not path.exists():
        raise ValueError("security/threat-model-sources.json missing")
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schema_version") != 1:
        raise ValueError("unsupported threat-model source policy")
    return payload


def meaningful_source_paths(repo_root: str | Path) -> list[str]:
    repo = Path(repo_root).resolve()
    policy = _source_policy(repo)
    exact = set(policy.get("include_exact", []))
    globs = list(policy.get("include_globs", []))
    excludes = tuple(policy.get("exclude_prefixes", []))
    result: list[str] = []
    for rel in _tracked_paths(repo):
        if rel == "security/threat-model.md" or rel.startswith(excludes):
            continue
        path = repo / rel
        if not path.is_file() or path.is_symlink():
            continue
        name = Path(rel).name
        if rel in exact or (policy.get("dependency_manifests") and name in DEPENDENCY_FILES) or any(fnmatch.fnmatch(rel, pattern) for pattern in globs):
            result.append(rel)
    return sorted(set(result))


def compute_input_digest(repo_root: str | Path) -> str:
    repo = Path(repo_root).resolve()
    digest = hashlib.sha256()
    for rel in meaningful_source_paths(repo):
        path = repo / rel
        digest.update(rel.encode("utf-8"))
        digest.update(b"\0")
        digest.update(hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest()


def _metadata(text: str) -> dict:
    match = FOOTER_RE.search(text)
    if not match:
        raise ValueError("threat model metadata footer missing")
    try:
        return json.loads(match.group(1))
    except json.JSONDecodeError as exc:
        raise ValueError("threat model metadata footer is invalid") from exc


def load_threat_model(repo_root: str | Path) -> ThreatModelRecord:
    repo = Path(repo_root).resolve()
    path = repo / "security" / "threat-model.md"
    text = path.read_text(encoding="utf-8")
    meta = _metadata(text)
    required = {"repository", "version", "generated_at", "input_digest"}
    if missing := required - set(meta):
        raise ValueError(f"threat model footer missing fields: {sorted(missing)}")

    def section(name: str) -> list[str]:
        match = re.search(rf"^## {re.escape(name)}\s*$([\s\S]*?)(?=^## |^<!-- gauntlet-threat-model|\Z)", text, re.M)
        if not match:
            return []
        return [m.group(1).strip() for m in re.finditer(r"^-\s+(.+)$", match.group(1), re.M) if m.group(1).strip()]

    return ThreatModelRecord(
        repository=meta["repository"], version=meta["version"], assets=section("Assets"),
        trustBoundaries=section("Trust boundaries"), attackerInputs=section("Attacker inputs"),
        invariants=section("Invariants"), assumptions=section("Assumptions"),
        generatedAt=meta["generated_at"], inputDigest=meta["input_digest"],
    )


def is_stale(repo_root: str | Path, record: ThreatModelRecord) -> bool:
    return record.inputDigest != compute_input_digest(repo_root)


def build_threat_model(repo_root: str | Path, *, write: bool = True) -> ThreatModelRecord:
    repo = Path(repo_root).resolve()
    assets = [
        "Repository source, tests, policy and executable verification evidence",
        "Harness provenance, immutable WorkContext/VerificationReceipt handshake and protected Codex policy",
        "Sealed security findings, coverage, validation and human triage history",
    ]
    boundaries = [
        "Untrusted task or pull-request input → repository workspace",
        "Harness lifecycle context → Gauntlet scope validation",
        "Project-owned code → Gauntlet verification and security artifact store",
        "Local workspace → CI final enforcement",
    ]
    attacker_inputs = [
        "User-controlled repository content and filenames",
        "Pull-request diffs and dependency manifests",
        "Knowledge-base documents explicitly selected for ingestion",
        "Untrusted values reaching shell, deserialization, authorization or file-write boundaries",
    ]
    invariants = [
        "qa/verify remains the only executable pass/fail authority",
        "Harness only supplies context and links receipts; Gauntlet never transitions lifecycle",
        "No external codex-security CLI, SDK, plugin or network service",
        "High/critical findings require evidence, validation disposition and complete attack path",
        "Risk acceptance is human-only, append-only and expires when configured",
    ]
    assumptions = [
        "The Git checkout and CI identity are trusted",
        "The workspace sandbox keeps outbound network disabled by default",
        "Static discovery can miss vulnerabilities and unsupported surfaces remain explicit proof gaps",
    ]
    record = ThreatModelRecord(
        repository=repo.name, version=current_revision(repo), assets=assets, trustBoundaries=boundaries,
        attackerInputs=attacker_inputs, invariants=invariants, assumptions=assumptions,
        generatedAt=utc_now(), inputDigest=compute_input_digest(repo),
    )
    if write:
        path = repo / "security" / "threat-model.md"
        path.parent.mkdir(parents=True, exist_ok=True)
        lines = ["# Repository threat model", ""]
        for title, values in (("Assets", assets), ("Trust boundaries", boundaries), ("Attacker inputs", attacker_inputs), ("Invariants", invariants), ("Assumptions", assumptions)):
            lines.extend([f"## {title}", "", *[f"- {value}" for value in values], ""])
        metadata = {"repository": repo.name, "version": record.version, "generated_at": record.generatedAt, "input_digest": record.inputDigest}
        lines.extend(["<!-- gauntlet-threat-model", json.dumps(metadata, sort_keys=True), "-->", ""])
        path.write_text("\n".join(lines), encoding="utf-8")
    return record
