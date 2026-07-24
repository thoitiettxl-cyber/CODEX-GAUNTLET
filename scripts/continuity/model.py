from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from typing import Any, Iterable

SCHEMA_VERSION = 1
MAX_IDENTIFIER = 128
MAX_TEXT = 1_000
MAX_ITEMS = 64
MAX_PACKET = 7_000

_ASSIGNMENT_SECRET = re.compile(
    r"(?i)\b(api[_-]?key|authorization|cookie|password|passwd|secret|token)"
    r"(\s*[:=]\s*)([^\s,;\"']+)"
)
_BEARER = re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{8,}")
_OPENAI_KEY = re.compile(r"\bsk-[A-Za-z0-9_-]{8,}\b")
_GITHUB_KEY = re.compile(r"\bgh[pousr]_[A-Za-z0-9]{12,}\b")
_URL_CREDENTIALS = re.compile(r"(?i)(https?://[^/\s:@]+:)[^@\s/]+@")
_PRIVATE_KEY = re.compile(
    r"-----BEGIN [^-]*PRIVATE KEY-----.*?-----END [^-]*PRIVATE KEY-----",
    re.DOTALL,
)
_SENSITIVE_KEY = re.compile(
    r"(?i)(api[_-]?key|authorization|cookie|password|passwd|private[_-]?key|secret|token)"
)


class ContinuityError(RuntimeError):
    """Base class for safe, expected continuity failures."""


class AmbiguousBinding(ContinuityError):
    """More than one active story exists and no exact binding is present."""


class BindingUnavailable(ContinuityError):
    """No existing binding or single active Harness story is available."""


class CheckpointConflict(ContinuityError):
    """The checkpoint head changed after the caller observed it."""


class InvalidCheckpoint(ContinuityError):
    """A checkpoint does not satisfy the v1 schema or checksum."""


class HumanDirectionRequired(ContinuityError):
    """A consequential operation cannot be retried automatically."""


class UnknownOperationOutcome(ContinuityError):
    """A target may have committed even though the caller did not observe it."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_utc(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def redact(value: str) -> str:
    text = _PRIVATE_KEY.sub("[REDACTED_PRIVATE_KEY]", str(value))
    text = _BEARER.sub("Bearer [REDACTED]", text)
    text = _ASSIGNMENT_SECRET.sub(lambda m: f"{m.group(1)}{m.group(2)}[REDACTED]", text)
    text = _OPENAI_KEY.sub("[REDACTED]", text)
    text = _GITHUB_KEY.sub("[REDACTED]", text)
    return _URL_CREDENTIALS.sub(r"\1[REDACTED]@", text)


def bounded_text(value: Any, limit: int = MAX_TEXT) -> str:
    text = redact("" if value is None else str(value)).replace("\x00", "")
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 14)] + "…[truncated]"


def identifier(value: Any, label: str) -> str:
    result = bounded_text(value, MAX_IDENTIFIER).strip()
    if not result:
        raise ValueError(f"{label} is required")
    return result


def bounded_list(values: Iterable[Any] | None) -> list[str]:
    if values is None:
        return []
    return [bounded_text(value) for value in list(values)[:MAX_ITEMS]]


def bounded_object(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {"state": bounded_text(value)}
    result: dict[str, Any] = {}
    for raw_key in sorted(value, key=lambda item: str(item))[:MAX_ITEMS]:
        key = bounded_text(raw_key, MAX_IDENTIFIER)
        raw_value = value[raw_key]
        if _SENSITIVE_KEY.search(key):
            result[key] = "[REDACTED]"
            continue
        if isinstance(raw_value, bool) or raw_value is None:
            result[key] = raw_value
        elif isinstance(raw_value, (int, float)):
            result[key] = raw_value
        elif isinstance(raw_value, list):
            result[key] = bounded_list(raw_value)
        else:
            result[key] = bounded_text(raw_value)
    return result


def compact_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def canonical_input(value: Any) -> str:
    """Canonicalize an operation input in memory without redacting its identity."""

    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return value
    return compact_json(value)


def operation_key(
    story_id: str,
    logical_step_id: str,
    operation: str,
    raw_canonical_input: Any,
) -> tuple[str, str]:
    canonical = canonical_input(raw_canonical_input)
    parts = [
        identifier(story_id, "story_id"),
        identifier(logical_step_id, "logical_step_id"),
        identifier(operation, "operation"),
        canonical,
    ]
    digest = hashlib.sha256("\x1f".join(parts).encode("utf-8")).hexdigest()
    input_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return digest, input_hash


CHECKPOINT_FIELDS = (
    "schema_version",
    "session_id",
    "story_id",
    "story_revision",
    "plan_path",
    "git_head",
    "worktree_status_hash",
    "last_safe_boundary",
    "completed_operations",
    "pending_operations",
    "external_side_effects",
    "verification_state",
    "next_action",
    "previous_checkpoint",
    "created_at",
)


def normalize_checkpoint(packet: dict[str, Any]) -> dict[str, Any]:
    normalized = {
        "schema_version": int(packet.get("schema_version", SCHEMA_VERSION)),
        "session_id": identifier(packet.get("session_id"), "session_id"),
        "story_id": identifier(packet.get("story_id"), "story_id"),
        "story_revision": bounded_text(packet.get("story_revision") or "unknown", MAX_IDENTIFIER),
        "plan_path": bounded_text(packet.get("plan_path") or "unknown", MAX_TEXT),
        "git_head": bounded_text(packet.get("git_head") or "unknown", MAX_IDENTIFIER),
        "worktree_status_hash": bounded_text(
            packet.get("worktree_status_hash") or "unknown", MAX_IDENTIFIER
        ),
        "last_safe_boundary": bounded_text(packet.get("last_safe_boundary")),
        "completed_operations": bounded_list(packet.get("completed_operations")),
        "pending_operations": bounded_list(packet.get("pending_operations")),
        "external_side_effects": bounded_list(packet.get("external_side_effects")),
        "verification_state": bounded_object(packet.get("verification_state") or {}),
        "next_action": bounded_text(packet.get("next_action")),
        "previous_checkpoint": packet.get("previous_checkpoint"),
        "created_at": bounded_text(packet.get("created_at") or utc_now(), MAX_IDENTIFIER),
    }
    if normalized["schema_version"] != SCHEMA_VERSION:
        raise InvalidCheckpoint(
            f"unsupported checkpoint schema {normalized['schema_version']}"
        )
    previous = normalized["previous_checkpoint"]
    if previous is not None:
        normalized["previous_checkpoint"] = int(previous)
    if not normalized["last_safe_boundary"]:
        raise InvalidCheckpoint("last_safe_boundary is required")
    if not normalized["next_action"]:
        raise InvalidCheckpoint("next_action is required")
    parse_utc(normalized["created_at"])
    return normalized


def checkpoint_checksum(packet: dict[str, Any]) -> str:
    canonical = {field: packet[field] for field in CHECKPOINT_FIELDS}
    return hashlib.sha256(compact_json(canonical).encode("utf-8")).hexdigest()


def validated_checkpoint(packet: dict[str, Any]) -> dict[str, Any]:
    normalized = normalize_checkpoint(packet)
    expected = checkpoint_checksum(normalized)
    actual = str(packet.get("checksum") or "")
    if actual != expected:
        raise InvalidCheckpoint("checkpoint checksum mismatch")
    normalized["checksum"] = actual
    if "id" in packet:
        normalized["id"] = int(packet["id"])
    return normalized


def build_system_message(
    packet: dict[str, Any],
    *,
    degraded: Iterable[str] = (),
    source: str,
) -> str:
    def bullets(values: list[str], empty: str) -> str:
        selected = values[:8]
        return "; ".join(selected) if selected else empty

    lines = [
        f"Continuity recovery ({bounded_text(source, 40)}):",
        f"- Story: {packet['story_id']}",
        f"- Plan: {packet['plan_path']}",
        f"- Last safe boundary: {packet['last_safe_boundary']}",
        "- Completed: "
        + bullets(packet.get("completed_operations", []), "none recorded"),
        "- Pending: " + bullets(packet.get("pending_operations", []), "none recorded"),
        "- External observations: "
        + bullets(packet.get("external_side_effects", []), "none recorded"),
        "- Verification: " + bounded_text(compact_json(packet.get("verification_state", {}))),
        f"- Exact next action: {packet['next_action']}",
    ]
    degraded_items = [bounded_text(item, 240) for item in degraded if item]
    if degraded_items:
        lines.append("- Degraded recovery: " + "; ".join(degraded_items[:4]))
    message = "\n".join(lines)
    return bounded_text(message, MAX_PACKET)
