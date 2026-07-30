from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

from ..common import atomic_write_json, utc_now

ACTIONS = {"false_positive", "accepted_risk", "wont_fix", "resolved"}
AUTOMATION_IDENTITIES = {"codex", "agent", "automation", "bot", "github-actions"}


@dataclass
class FindingTriage:
    findingId: str
    action: str
    reason: str
    approvedBy: str
    approvedAt: str
    expiresAt: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)


def validate_triage(record: dict) -> list[str]:
    errors = []
    if record.get("action") not in ACTIONS:
        errors.append("triage action invalid")
    if not str(record.get("findingId") or "").strip():
        errors.append("triage findingId missing")
    if not str(record.get("reason") or "").strip():
        errors.append("triage reason is required")
    approved = str(record.get("approvedBy") or "").strip()
    if not approved:
        errors.append("triage approvedBy is required")
    if approved.lower() in AUTOMATION_IDENTITIES or approved.lower().endswith("[bot]"):
        errors.append("triage must be approved by a human identity")
    if not str(record.get("approvedAt") or "").strip():
        errors.append("triage approvedAt is required")
    expires = record.get("expiresAt")
    if expires:
        try:
            datetime.fromisoformat(str(expires).replace("Z", "+00:00"))
        except ValueError:
            errors.append("triage expiresAt invalid")
    return errors


def is_active(record: dict, now: datetime | None = None) -> bool:
    if validate_triage(record):
        return False
    expires = record.get("expiresAt")
    if not expires:
        return True
    current = now or datetime.now(timezone.utc)
    return datetime.fromisoformat(expires.replace("Z", "+00:00")) > current


def write_triage(repo_root: str | Path, record: FindingTriage) -> Path:
    payload = record.to_dict()
    errors = validate_triage(payload)
    if errors:
        raise ValueError("invalid triage: " + "; ".join(errors))
    root = Path(repo_root).resolve() / "qa" / "security" / "triage"
    root.mkdir(parents=True, exist_ok=True)
    stamp = record.approvedAt.replace(":", "-").replace("Z", "")
    path = root / f"{record.findingId}--{stamp}.json"
    if path.exists():
        raise FileExistsError("triage audit record is append-only")
    atomic_write_json(path, payload)
    return path


def load_active_triage(repo_root: str | Path) -> dict[str, dict]:
    root = Path(repo_root).resolve() / "qa" / "security" / "triage"
    records: dict[str, dict] = {}
    if not root.exists():
        return records
    import json
    for path in sorted(root.glob("*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        if is_active(payload):
            records[payload["findingId"]] = payload
    return records


def compare_scans(previous: list[dict], current: list[dict]) -> dict:
    before = {item["findingId"] for item in previous}
    after = {item["findingId"] for item in current}
    return {"fixed": sorted(before - after), "persistent": sorted(before & after), "new": sorted(after - before)}
