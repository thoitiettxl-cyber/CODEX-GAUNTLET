"""Integrity contracts for the one-way Harness to Gauntlet handshake.

The local repository cannot turn a same-user digest into an authentication
boundary. V6 therefore combines protected WorkContext files, a process-bound
receipt issuer, structured command records, sealed evidence manifests, and
independent CI verification.

The module intentionally exposes no permissive receipt writer. Callers must
run the canonical qa/verify entrypoint; direct issuance is rejected.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

SCHEMA_VERSION = "1"
WORK_MODES = {"read_only", "targeted", "stop", "ci", "audit"}
RECEIPT_MODES = {"targeted", "stop", "ci", "audit"}
COMPLEXITY_CLASSES = {"read_only", "bounded", "complex", "maintenance"}
RESULTS = {"pass", "fail", "incomplete"}
POLICY_FILES = (
    "qa/policy.json",
    "qa/verify-matrix.yaml",
    "qa/thresholds.json",
    "qa/security/thresholds.json",
    "qa/classify_changes.py",
    "qa/gate_selection.py",
    "scripts/gauntlet_handshake.py",
    "scripts/gauntlet_policy.py",
    ".codex/hooks/common.py",
    ".codex/hooks/pre_tool_use_policy.py",
    ".codex/hooks/permission_request_policy.py",
)
EVIDENCE_ROOT = "artifacts/verification/evidence"
RECEIPT_ROOT = "artifacts/verification/receipts"
LOG_ROOT = ".qa-artifacts/evidence"
TARGET_STATE_EXCLUDED_PREFIXES = (
    ".harness/changesets/",
    ".harness/epoch-transition/",
    ".harness/receipt-links/",
    ".harness/work-context/",
    ".qa-artifacts/",
    "artifacts/metrics/",
    "artifacts/verification/evidence/",
    "artifacts/verification/receipts/",
    "qa/security/reports/",
)

# A Python object is not a same-user security boundary. This registry instead
# enforces the narrower contract that only the live canonical verifier
# invocation can call the issuance APIs accidentally or through ordinary
# imports. Independent CI and immutable command logs remain the trust boundary.
_ACTIVE_ISSUERS: dict[str, object] = {}
_SEALED_EVIDENCE: dict[str, tuple[str, str]] = {}


def utc_now() -> str:
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def canonical_bytes(payload: Any) -> bytes:
    return json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")


def payload_digest(
    payload: dict[str, Any],
    *,
    omit: Iterable[str] = ("digest",),
) -> str:
    omitted = set(omit)
    clean = {key: value for key, value in payload.items() if key not in omitted}
    return hashlib.sha256(canonical_bytes(clean)).hexdigest()


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _git(repo: Path, *args: str, check: bool = True) -> str:
    proc = subprocess.run(
        ["git", *args],
        cwd=repo,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if check and proc.returncode:
        raise ValueError(proc.stderr.strip() or f"git {' '.join(args)} failed")
    return proc.stdout.strip()


def current_revision(repo: Path) -> str:
    try:
        return _git(repo, "rev-parse", "HEAD")
    except ValueError:
        return "UNVERSIONED"


def _target_state_excluded(path: str) -> bool:
    normalized = path.replace("\\", "/")
    while normalized.startswith("./"):
        normalized = normalized[2:]
    return any(
        normalized == prefix.rstrip("/") or normalized.startswith(prefix)
        for prefix in TARGET_STATE_EXCLUDED_PREFIXES
    )


def _git_changed_paths(repo: Path, *, base: str | None = None) -> list[str]:
    commands: list[tuple[str, ...]] = []
    if base:
        commands.append(("diff", "--name-only", f"{base}...HEAD"))
    commands.extend(
        (
            ("diff", "--name-only", "HEAD"),
            ("diff", "--name-only", "--cached"),
            ("ls-files", "--others", "--exclude-standard"),
        )
    )
    paths: set[str] = set()
    for args in commands:
        paths.update(_git(repo, *args, check=False).splitlines())
    return sorted(path for path in paths if path and not _target_state_excluded(path))


def _path_state(repo: Path, rel: str) -> dict[str, Any]:
    path = repo / rel
    index = _git(repo, "ls-files", "-s", "--", rel, check=False)
    if path.is_symlink():
        return {
            "path": rel,
            "kind": "symlink",
            "target": os.readlink(path),
            "index": index,
        }
    if path.is_file():
        stat = path.stat()
        return {
            "path": rel,
            "kind": "file",
            "sha256": sha256_file(path),
            "executable": bool(stat.st_mode & 0o111),
            "index": index,
        }
    if path.exists():
        return {"path": rel, "kind": "other", "index": index}
    return {"path": rel, "kind": "deleted", "index": index}


def _working_state(repo: Path, *, base: str | None = None) -> list[dict[str, Any]]:
    return [_path_state(repo, rel) for rel in _git_changed_paths(repo, base=base)]


def repository_root_digest(repo: Path) -> str:
    identity_file = repo / "qa" / "repository-identity.json"
    if identity_file.is_file():
        identity = json.loads(identity_file.read_text(encoding="utf-8"))
        stable_id = str(identity.get("repository_id") or "").strip()
        if not stable_id:
            raise ValueError("qa/repository-identity.json lacks repository_id")
        return hashlib.sha256(
            canonical_bytes(
                {
                    "repositoryId": stable_id,
                    "schemaVersion": identity.get("schema_version"),
                }
            )
        ).hexdigest()
    roots = _git(
        repo,
        "rev-list",
        "--max-parents=0",
        "HEAD",
        check=False,
    ).splitlines()
    return hashlib.sha256(canonical_bytes({"roots": sorted(roots)})).hexdigest()


def dirty_state_digest(repo: Path) -> str | None:
    state = _working_state(repo)
    return hashlib.sha256(canonical_bytes(state)).hexdigest() if state else None


def final_diff_digest(repo: Path, *, base: str | None = None) -> str:
    canonical_base = _validate_commit(repo, base) if base else None
    return hashlib.sha256(
        canonical_bytes(
            {
                "baseRevision": canonical_base,
                "revision": current_revision(repo),
                "state": _working_state(repo, base=canonical_base),
            }
        )
    ).hexdigest()


def normalize_repo_path(
    repo: Path,
    value: str,
    *,
    require_exists: bool = False,
) -> str:
    raw = Path(value)
    if raw.is_absolute():
        raise ValueError(f"absolute path is not allowed: {value}")
    candidate = (repo / raw).resolve(strict=require_exists)
    try:
        relative = candidate.relative_to(repo.resolve())
    except ValueError as exc:
        raise ValueError(f"path escapes repository: {value}") from exc
    if not relative.parts or any(part in ("", ".", "..") for part in relative.parts):
        raise ValueError(f"unsafe repository path: {value}")
    return relative.as_posix()


def _validate_commit(repo: Path, revision: str) -> str:
    if not revision or revision.startswith("-"):
        raise ValueError("invalid revision")
    return _git(repo, "rev-parse", "--verify", f"{revision}^{{commit}}")


def adapter_digest(repo: Path) -> str:
    adapter = repo / "scripts" / "gauntlet_handshake.py"
    return sha256_file(adapter) if adapter.is_file() else "MISSING"


def load_work_graph(repo: Path) -> dict[str, Any]:
    controller = repo / "scripts" / "termux-control"
    if not controller.is_file():
        raise ValueError("Harness control entrypoint is missing")
    proc = subprocess.run(
        [
            str(controller),
            "orchestrator",
            "query",
            "work-graph",
            "--json",
        ],
        cwd=repo,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if proc.returncode:
        raise ValueError(
            "cannot read Harness work graph: "
            + (proc.stderr.strip() or proc.stdout.strip() or "unknown error")
        )
    try:
        envelope = json.loads(proc.stdout)
        graph = envelope["result"]
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        raise ValueError("Harness work graph response is invalid") from exc
    if not isinstance(graph, dict) or not isinstance(graph.get("stories"), list):
        raise ValueError("Harness work graph lacks stories")
    return graph


def work_graph_story(graph: dict[str, Any], story_id: str) -> dict[str, Any]:
    matches = [
        item
        for item in graph.get("stories", [])
        if isinstance(item, dict) and item.get("id") == story_id
    ]
    if len(matches) != 1:
        raise ValueError(f"Harness story does not exist: {story_id}")
    return matches[0]


def create_work_context(
    repo: Path,
    *,
    run_id: str,
    requested_mode: str,
    complexity_class: str,
    runnable: bool,
    changed_paths: Iterable[str],
    base_revision: str = "HEAD",
    head_revision: str | None = None,
    story_id: str | None = None,
    linked_plan: str | None = None,
    declared_change_classes: Iterable[str] = (),
    work_graph_revision: str | None = None,
    dependency_state_digest: str | None = None,
) -> dict[str, Any]:
    if requested_mode not in WORK_MODES:
        raise ValueError(f"invalid requested mode: {requested_mode}")
    if complexity_class not in COMPLEXITY_CLASSES:
        raise ValueError(f"invalid complexity class: {complexity_class}")
    if not str(run_id).strip():
        raise ValueError("runId is required")
    paths = sorted(
        {
            normalize_repo_path(repo, path, require_exists=False)
            for path in changed_paths
        }
    )
    base = _validate_commit(repo, base_revision)
    head = _validate_commit(repo, head_revision) if head_revision else None
    context: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "runId": run_id,
        "repository": {
            "rootDigest": repository_root_digest(repo),
            "baseRevision": base,
            **({"headRevision": head} if head else {}),
        },
        "scope": {"changedPaths": paths, "requestedMode": requested_mode},
        "harness": {
            "complexityClass": complexity_class,
            "runnable": bool(runnable),
            **(
                {
                    "linkedPlan": normalize_repo_path(
                        repo,
                        linked_plan,
                        require_exists=True,
                    )
                }
                if linked_plan
                else {}
            ),
            **(
                {"workGraphRevision": work_graph_revision}
                if work_graph_revision
                else {}
            ),
            **(
                {"dependencyStateDigest": dependency_state_digest}
                if dependency_state_digest
                else {}
            ),
        },
        "hints": {
            "declaredChangeClasses": sorted(set(declared_change_classes))
        },
        "issuedAt": utc_now(),
        "issuer": "repository-harness",
        "issuerDigest": adapter_digest(repo),
    }
    if story_id:
        context["storyId"] = story_id
    context["digest"] = payload_digest(context)
    return context


def validate_work_context(
    repo: Path,
    context: dict[str, Any],
    *,
    requested_mode: str | None = None,
) -> dict[str, Any]:
    errors: list[str] = []
    if context.get("schemaVersion") != SCHEMA_VERSION:
        errors.append("unsupported WorkContext schemaVersion")
    if context.get("issuer") != "repository-harness":
        errors.append("WorkContext issuer must be repository-harness")
    if context.get("issuerDigest") != adapter_digest(repo):
        errors.append("WorkContext issuer adapter is stale")
    if not str(context.get("runId") or "").strip():
        errors.append("WorkContext runId missing")
    if context.get("digest") != payload_digest(context):
        errors.append("WorkContext digest mismatch")

    repository = (
        context.get("repository")
        if isinstance(context.get("repository"), dict)
        else {}
    )
    if repository.get("rootDigest") != repository_root_digest(repo):
        errors.append("WorkContext repository root digest mismatch")
    for key in ("baseRevision", "headRevision"):
        value = repository.get(key)
        if value:
            try:
                resolved = _validate_commit(repo, str(value))
                if resolved != value:
                    errors.append(f"WorkContext {key} is not canonical")
            except ValueError:
                errors.append(f"WorkContext {key} is invalid")

    scope = context.get("scope") if isinstance(context.get("scope"), dict) else {}
    mode = scope.get("requestedMode")
    if mode not in WORK_MODES:
        errors.append("WorkContext requestedMode invalid")
    if requested_mode and mode != requested_mode:
        errors.append(
            f"WorkContext requestedMode {mode!r} does not match invocation "
            f"{requested_mode!r}"
        )
    changed = scope.get("changedPaths")
    if not isinstance(changed, list):
        errors.append("WorkContext changedPaths must be a list")
    else:
        for value in changed:
            try:
                normalize_repo_path(repo, str(value), require_exists=False)
            except ValueError as exc:
                errors.append(str(exc))

    harness = (
        context.get("harness")
        if isinstance(context.get("harness"), dict)
        else {}
    )
    complexity = harness.get("complexityClass")
    if complexity not in COMPLEXITY_CLASSES:
        errors.append("WorkContext complexityClass invalid")
    if complexity == "complex" and not context.get("storyId"):
        errors.append("complex WorkContext requires storyId")
    if complexity == "complex" and not harness.get("linkedPlan"):
        errors.append("complex WorkContext requires linkedPlan")
    if complexity == "complex" and harness.get("runnable") is not True:
        errors.append("complex WorkContext is not runnable")

    story_id = str(context.get("storyId") or "").strip()
    if story_id:
        try:
            graph = load_work_graph(repo)
            story = work_graph_story(graph, story_id)
            story_active = story.get("status") in {"in_progress", "changed"}
            story_runnable = story.get("runnable") is True
            if not (story_active or story_runnable):
                errors.append(
                    f"Harness story {story_id} is neither active nor runnable: "
                    f"{story.get('status')}"
                )
            linked_plan = harness.get("linkedPlan")
            if linked_plan and story.get("contract_doc") != linked_plan:
                errors.append("WorkContext linkedPlan does not match Harness story")
            graph_revision = harness.get("workGraphRevision")
            if graph_revision and graph.get("revision") != graph_revision:
                errors.append("WorkContext work graph revision is stale")
        except ValueError as exc:
            errors.append(str(exc))

    if errors:
        raise ValueError("; ".join(errors))
    return context


def load_work_context(
    repo: Path,
    path: str | Path,
    *,
    requested_mode: str | None = None,
) -> dict[str, Any]:
    candidate = Path(path)
    if not candidate.is_absolute():
        candidate = repo / candidate
    try:
        candidate.resolve().relative_to(repo.resolve())
    except ValueError as exc:
        raise ValueError("WorkContext path escapes repository") from exc
    payload = json.loads(candidate.read_text(encoding="utf-8"))
    return validate_work_context(repo, payload, requested_mode=requested_mode)


def policy_state(repo: Path) -> dict[str, str]:
    config = json.loads((repo / "qa" / "policy.json").read_text(encoding="utf-8"))
    digest = hashlib.sha256()
    for rel in POLICY_FILES:
        path = repo / rel
        if not path.is_file():
            raise ValueError(f"policy input missing: {rel}")
        digest.update(rel.encode("utf-8"))
        digest.update(b"\0")
        digest.update(hashlib.sha256(path.read_bytes()).digest())
    policy_digest = digest.hexdigest()
    return {
        "policyVersion": f"{config['policy_version']}+{policy_digest[:12]}",
        "classifierVersion": str(config["classifier_version"]),
        "toolchainAdapterVersion": str(config["toolchain_adapter_version"]),
        "policyDigest": policy_digest,
    }


def _threat_model_input_digest(repo: Path) -> str:
    model_path = repo / "security" / "threat-model.md"
    if not model_path.exists():
        return ""
    match = re.search(
        r"<!-- gauntlet-threat-model\s*(\{.*?\})\s*-->",
        model_path.read_text(encoding="utf-8"),
        re.S,
    )
    if not match:
        return "INVALID"
    try:
        return str(json.loads(match.group(1)).get("input_digest") or "")
    except json.JSONDecodeError:
        return "INVALID"


def _knowledge_base_digest(repo: Path) -> str:
    sources: list[dict[str, Any]] = []
    candidates = [
        "AGENTS.md",
        "SECURITY.md",
        "docs/quality/SECURITY-GATE.md",
        "security/threat-model-sources.json",
    ]
    security_docs = repo / "docs" / "security"
    if security_docs.is_dir():
        candidates.extend(
            path.relative_to(repo).as_posix()
            for path in sorted(security_docs.rglob("*"))
            if path.is_file()
        )
    for rel in candidates:
        path = repo / rel
        if path.is_file() and not path.is_symlink():
            data = path.read_bytes()
            sources.append(
                {
                    "path": rel,
                    "sha256": hashlib.sha256(data).hexdigest(),
                    "bytes": len(data),
                }
            )
    return (
        hashlib.sha256(canonical_bytes(sources)).hexdigest()
        if sources
        else ""
    )


def compute_target_digest(
    repo: Path,
    *,
    paths: Iterable[str],
    mode: str,
    threat_model_digest: str | None = None,
    knowledge_base_digest: str | None = None,
    diff_digest: str | None = None,
    base_revision: str | None = None,
) -> str:
    if mode not in WORK_MODES:
        raise ValueError(f"invalid target mode: {mode}")
    state = policy_state(repo)
    payload = {
        "repository": repository_root_digest(repo),
        "revision": current_revision(repo),
        "dirtyStateDigest": dirty_state_digest(repo),
        "baseRevision": (
            _validate_commit(repo, base_revision) if base_revision else None
        ),
        "paths": sorted(
            {
                normalize_repo_path(repo, path, require_exists=False)
                for path in paths
            }
        ),
        "mode": mode,
        "diffDigest": (
            diff_digest
            if diff_digest is not None
            else final_diff_digest(repo, base=base_revision)
        ),
        "policyVersion": state["policyVersion"],
        "classifierVersion": state["classifierVersion"],
        "toolchainAdapterVersion": state["toolchainAdapterVersion"],
        "threatModelDigest": (
            _threat_model_input_digest(repo)
            if threat_model_digest is None
            else threat_model_digest
        ),
        "knowledgeBaseDigest": (
            _knowledge_base_digest(repo)
            if knowledge_base_digest is None
            else knowledge_base_digest
        ),
    }
    return hashlib.sha256(canonical_bytes(payload)).hexdigest()


@dataclass(frozen=True)
class ReceiptIssuer:
    executablePath: str
    executableDigest: str
    invocationId: str
    _capability: object = field(repr=False, compare=False)


def _assert_receipt_issuer(repo: Path, issuer: ReceiptIssuer) -> None:
    expected = (repo / "qa" / "verify_v6.py").resolve()
    expected_path = expected.relative_to(repo.resolve()).as_posix()
    if not expected.is_file():
        raise PermissionError("canonical verifier executable is missing")
    if (
        issuer.executablePath != expected_path
        or issuer.executableDigest != sha256_file(expected)
        or _ACTIVE_ISSUERS.get(issuer.invocationId) is not issuer._capability
    ):
        raise PermissionError(
            "receipt issuer capability is not owned by the active qa/verify "
            "invocation"
        )


def acquire_receipt_issuer(repo: Path) -> ReceiptIssuer:
    expected = (repo / "qa" / "verify_v6.py").resolve()
    actual = Path(sys.argv[0]).resolve()
    if actual != expected:
        raise PermissionError(
            "VerificationReceipt issuance is restricted to qa/verify; "
            f"active executable is {actual}"
        )
    capability = object()
    issuer = ReceiptIssuer(
        executablePath=expected.relative_to(repo.resolve()).as_posix(),
        executableDigest=sha256_file(expected),
        invocationId=f"verify-{uuid.uuid4().hex}",
        _capability=capability,
    )
    _ACTIVE_ISSUERS[issuer.invocationId] = capability
    return issuer


def validate_evidence_manifest(
    repo: Path,
    manifest: dict[str, Any],
    *,
    current: bool = True,
) -> list[str]:
    errors: list[str] = []
    if manifest.get("schemaVersion") != SCHEMA_VERSION:
        errors.append("evidence schemaVersion invalid")
    if manifest.get("digest") != payload_digest(manifest):
        errors.append("evidence manifest digest mismatch")
    if manifest.get("result") not in RESULTS:
        errors.append("evidence result invalid")
    if manifest.get("mode") not in RECEIPT_MODES:
        errors.append("evidence mode invalid")
    invocation_id = str(manifest.get("invocationId") or "")
    if not re.fullmatch(r"verify-[0-9a-f]{32}", invocation_id):
        errors.append("evidence invocationId invalid")
    if not re.fullmatch(r"[0-9a-f]{64}", str(manifest.get("targetDigest") or "")):
        errors.append("evidence targetDigest invalid")
    issuer = manifest.get("issuer") if isinstance(manifest.get("issuer"), dict) else {}
    if issuer.get("executablePath") != "qa/verify_v6.py":
        errors.append("evidence issuer path is not canonical")
    verifier = repo / "qa" / "verify_v6.py"
    if not verifier.is_file() or issuer.get("executableDigest") != sha256_file(verifier):
        errors.append("evidence issuer executable is stale")
    records = manifest.get("commandRecords")
    if not isinstance(records, list) or not records:
        errors.append("evidence command records missing")
        records = []
    successful_gates: set[str] = set()
    for index, record in enumerate(records):
        if not isinstance(record, dict):
            errors.append(f"evidence commandRecords[{index}] invalid")
            continue
        gate = str(record.get("gate") or "")
        argv = record.get("argv")
        if not gate or not isinstance(argv, list) or not argv:
            errors.append(f"evidence commandRecords[{index}] lacks gate/argv")
        if not isinstance(record.get("exitCode"), int):
            errors.append(f"evidence commandRecords[{index}] lacks exitCode")
        elif record["exitCode"] == 0:
            successful_gates.add(gate)
        log_path = record.get("logPath")
        try:
            normalized_log = normalize_repo_path(
                repo,
                str(log_path),
                require_exists=True,
            )
        except (ValueError, FileNotFoundError):
            errors.append(f"evidence commandRecords[{index}] log missing/unsafe")
            continue
        if not normalized_log.startswith(LOG_ROOT + "/"):
            errors.append(f"evidence commandRecords[{index}] log outside evidence root")
            continue
        if record.get("logSha256") != sha256_file(repo / normalized_log):
            errors.append(f"evidence commandRecords[{index}] log digest mismatch")
    selected = manifest.get("selectedGates")
    if not isinstance(selected, list):
        errors.append("evidence selectedGates invalid")
        selected = []
    if manifest.get("result") == "pass":
        failed = [
            record
            for record in records
            if isinstance(record, dict) and record.get("exitCode") != 0
        ]
        if failed:
            errors.append("pass evidence contains a failed command")
        missing = set(map(str, selected)) - successful_gates
        if missing:
            errors.append(
                "pass evidence lacks successful gate records: "
                + ", ".join(sorted(missing))
            )
        if not manifest.get("finalDiffDigest"):
            errors.append("pass evidence lacks finalDiffDigest")
        if manifest.get("finalStateChecked") is not True:
            errors.append("pass evidence lacks final-state check")
    if current:
        repository = manifest.get("repository", {})
        if repository.get("revision") != current_revision(repo):
            errors.append("evidence revision is stale")
        if repository.get("dirtyStateDigest") != (
            dirty_state_digest(repo) or "CLEAN"
        ):
            errors.append("evidence dirty state is stale")
        base_revision = manifest.get("baseRevision")
        if base_revision:
            try:
                base_revision = _validate_commit(repo, str(base_revision))
            except ValueError:
                errors.append("evidence base revision is invalid")
                base_revision = None
        if manifest.get("finalDiffDigest") != final_diff_digest(
            repo,
            base=base_revision,
        ):
            errors.append("evidence final diff is stale")
    return errors


def seal_evidence_manifest(
    repo: Path,
    issuer: ReceiptIssuer,
    *,
    mode: str,
    target_digest: str,
    selected_gates: Iterable[str],
    command_records: Iterable[dict[str, Any]],
    result: str,
    proof_gaps: Iterable[str],
    final_diff_digest_value: str,
    final_state_checked: bool,
    started_at: str,
    completed_at: str,
    base_revision: str | None = None,
) -> Path:
    _assert_receipt_issuer(repo, issuer)
    if issuer.invocationId in _SEALED_EVIDENCE:
        raise PermissionError("receipt issuer invocation already sealed evidence")
    if result not in RESULTS:
        raise ValueError(f"invalid evidence result: {result}")
    manifest: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "invocationId": issuer.invocationId,
        "issuer": {
            "executablePath": issuer.executablePath,
            "executableDigest": issuer.executableDigest,
        },
        "repository": {
            "revision": current_revision(repo),
            "dirtyStateDigest": dirty_state_digest(repo) or "CLEAN",
        },
        "mode": mode,
        "targetDigest": target_digest,
        "selectedGates": sorted(set(map(str, selected_gates))),
        "commandRecords": list(command_records),
        "result": result,
        "proofGaps": sorted(set(map(str, proof_gaps))),
        "finalDiffDigest": final_diff_digest_value,
        "baseRevision": (
            _validate_commit(repo, base_revision) if base_revision else None
        ),
        "finalStateChecked": bool(final_state_checked),
        "startedAt": started_at,
        "completedAt": completed_at,
    }
    manifest["digest"] = payload_digest(manifest)
    errors = validate_evidence_manifest(repo, manifest, current=True)
    if errors:
        raise ValueError("invalid executable evidence: " + "; ".join(errors))
    output = repo / EVIDENCE_ROOT / f"{issuer.invocationId}.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2, sort_keys=True)
        handle.write("\n")
    output.chmod(0o444)
    _SEALED_EVIDENCE[issuer.invocationId] = (
        output.relative_to(repo).as_posix(),
        sha256_file(output),
    )
    return output


def _load_evidence_reference(
    repo: Path,
    reference: dict[str, Any],
    *,
    current: bool,
) -> tuple[dict[str, Any] | None, list[str]]:
    errors: list[str] = []
    if reference.get("kind") != "verification-evidence-manifest":
        return None, ["receipt evidence reference kind invalid"]
    try:
        rel = normalize_repo_path(
            repo,
            str(reference.get("path") or ""),
            require_exists=True,
        )
    except (ValueError, FileNotFoundError) as exc:
        return None, [f"receipt evidence manifest missing/unsafe: {exc}"]
    if not rel.startswith(EVIDENCE_ROOT + "/"):
        return None, ["receipt evidence manifest outside evidence store"]
    path = repo / rel
    if reference.get("sha256") != sha256_file(path):
        errors.append("receipt evidence manifest file digest mismatch")
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return None, errors + [f"cannot read receipt evidence manifest: {exc}"]
    errors.extend(validate_evidence_manifest(repo, manifest, current=current))
    return manifest, errors


def issue_receipt(
    repo: Path,
    issuer: ReceiptIssuer,
    *,
    mode: str,
    paths: Iterable[str],
    selected_gates: Iterable[str],
    classification_records: Iterable[str],
    result: str,
    evidence_manifest_path: str | Path,
    proof_gaps: Iterable[str],
    work_context: dict[str, Any] | None = None,
    security_report_id: str | None = None,
    started_at: str | None = None,
    completed_at: str | None = None,
    target_digest: str | None = None,
    diff_digest: str | None = None,
    base_revision: str | None = None,
) -> Path:
    _assert_receipt_issuer(repo, issuer)
    if mode not in RECEIPT_MODES:
        raise ValueError(f"invalid receipt mode: {mode}")
    if result not in RESULTS:
        raise ValueError(f"invalid receipt result: {result}")
    normalized_paths = sorted(
        {
            normalize_repo_path(repo, path, require_exists=False)
            for path in paths
        }
    )
    evidence_path = Path(evidence_manifest_path)
    evidence_path = (
        evidence_path.resolve()
        if evidence_path.is_absolute()
        else (repo / evidence_path).resolve()
    )
    try:
        evidence_rel = evidence_path.relative_to(repo.resolve()).as_posix()
    except ValueError as exc:
        raise ValueError("evidence manifest escapes repository") from exc
    sealed = _SEALED_EVIDENCE.get(issuer.invocationId)
    if sealed != (evidence_rel, sha256_file(evidence_path)):
        raise PermissionError(
            "evidence was not sealed by this active qa/verify invocation"
        )
    evidence_ref = {
        "kind": "verification-evidence-manifest",
        "path": evidence_rel,
        "sha256": sha256_file(evidence_path),
    }
    manifest, evidence_errors = _load_evidence_reference(
        repo,
        evidence_ref,
        current=True,
    )
    if evidence_errors:
        raise ValueError("invalid receipt evidence: " + "; ".join(evidence_errors))
    assert manifest is not None
    if manifest.get("invocationId") != issuer.invocationId:
        raise ValueError("receipt invocation does not match evidence invocation")
    gates = sorted(set(map(str, selected_gates)))
    effective_target_digest = target_digest or compute_target_digest(
        repo,
        paths=normalized_paths,
        mode=mode,
        diff_digest=diff_digest,
        base_revision=base_revision,
    )
    if manifest.get("result") != result:
        raise ValueError("receipt result does not match evidence result")
    if manifest.get("mode") != mode:
        raise ValueError("receipt mode does not match evidence mode")
    if manifest.get("targetDigest") != effective_target_digest:
        raise ValueError("receipt target does not match evidence target")
    if manifest.get("selectedGates") != gates:
        raise ValueError("receipt gates do not match evidence gates")
    effective_diff_digest = (
        diff_digest
        if diff_digest is not None
        else final_diff_digest(repo, base=base_revision)
    )
    if manifest.get("finalDiffDigest") != effective_diff_digest:
        raise ValueError("receipt final diff does not match executable evidence")

    policy = policy_state(repo)
    receipt: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "receiptId": "pending",
        "issuer": {
            "name": "./qa/verify",
            "executablePath": issuer.executablePath,
            "executableDigest": issuer.executableDigest,
            "invocationId": issuer.invocationId,
        },
        "repository": {
            "revision": current_revision(repo),
            "dirtyStateDigest": dirty_state_digest(repo) or "CLEAN",
        },
        "target": {
            "targetDigest": effective_target_digest,
            "paths": normalized_paths,
            "mode": mode,
            "diffDigest": effective_diff_digest,
            "baseRevision": (
                _validate_commit(repo, base_revision)
                if base_revision
                else None
            ),
            "threatModelDigest": _threat_model_input_digest(repo),
            "knowledgeBaseDigest": _knowledge_base_digest(repo),
        },
        "policy": {
            "policyVersion": policy["policyVersion"],
            "classifierVersion": policy["classifierVersion"],
            "selectedGates": gates,
            "classificationRecords": sorted(
                set(map(str, classification_records))
            ),
        },
        "result": result,
        "evidenceRefs": [evidence_ref],
        "proofGaps": sorted(set(map(str, proof_gaps))),
        "startedAt": started_at or utc_now(),
        "completedAt": completed_at or utc_now(),
    }
    if work_context:
        validated = validate_work_context(repo, work_context, requested_mode=mode)
        receipt["runId"] = validated.get("runId")
        if validated.get("storyId"):
            receipt["storyId"] = validated["storyId"]
        receipt["workContextDigest"] = validated["digest"]
    if security_report_id:
        receipt["securityReportId"] = security_report_id
    pre_id = payload_digest(receipt, omit=("digest", "receiptId"))
    receipt["receiptId"] = f"vr-{pre_id[:32]}"
    receipt["digest"] = payload_digest(receipt)

    validation_errors = validate_receipt(repo, receipt, current=True)
    if validation_errors:
        raise ValueError("invalid VerificationReceipt: " + "; ".join(validation_errors))

    output = (
        repo
        / RECEIPT_ROOT
        / f"{issuer.invocationId}-{receipt['receiptId']}.json"
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(receipt, handle, indent=2, sort_keys=True)
        handle.write("\n")
    output.chmod(0o444)
    pointer = repo / ".qa-artifacts" / "latest-receipt.json"
    pointer.parent.mkdir(parents=True, exist_ok=True)
    pointer.write_text(
        json.dumps(
            {"receipt": output.relative_to(repo).as_posix()},
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    _ACTIVE_ISSUERS.pop(issuer.invocationId, None)
    _SEALED_EVIDENCE.pop(issuer.invocationId, None)
    return output


def write_receipt(*_args: Any, **_kwargs: Any) -> Path:
    """Reject the insecure v5/scaffold API explicitly."""

    raise PermissionError(
        "direct VerificationReceipt issuance is disabled; run ./qa/verify"
    )


def validate_receipt(
    repo: Path,
    receipt: dict[str, Any],
    *,
    current: bool = True,
) -> list[str]:
    errors: list[str] = []
    if receipt.get("schemaVersion") != SCHEMA_VERSION:
        errors.append("receipt schemaVersion invalid")
    if receipt.get("digest") != payload_digest(receipt):
        errors.append("receipt digest mismatch")
    expected_id = "vr-" + payload_digest(
        receipt,
        omit=("digest", "receiptId"),
    )[:32]
    if receipt.get("receiptId") != expected_id:
        errors.append("receiptId does not match receipt payload")
    if receipt.get("result") not in RESULTS:
        errors.append("receipt result invalid")
    issuer = receipt.get("issuer") if isinstance(receipt.get("issuer"), dict) else {}
    verifier = repo / "qa" / "verify_v6.py"
    if issuer.get("name") != "./qa/verify":
        errors.append("receipt issuer name invalid")
    if issuer.get("executablePath") != "qa/verify_v6.py":
        errors.append("receipt issuer path invalid")
    if not re.fullmatch(
        r"verify-[0-9a-f]{32}",
        str(issuer.get("invocationId") or ""),
    ):
        errors.append("receipt issuer invocationId invalid")
    if not verifier.is_file() or issuer.get("executableDigest") != sha256_file(verifier):
        errors.append("receipt issuer executable is stale")
    refs = receipt.get("evidenceRefs")
    if not isinstance(refs, list) or len(refs) != 1 or not isinstance(refs[0], dict):
        errors.append("receipt must reference exactly one evidence manifest")
        refs = []
    manifest: dict[str, Any] | None = None
    if refs:
        manifest, evidence_errors = _load_evidence_reference(
            repo,
            refs[0],
            current=current,
        )
        errors.extend(evidence_errors)

    target = receipt.get("target") if isinstance(receipt.get("target"), dict) else {}
    if target.get("mode") not in RECEIPT_MODES:
        errors.append("receipt target mode invalid")
    paths = target.get("paths")
    if not isinstance(paths, list):
        errors.append("receipt target paths invalid")
        paths = []
    for path in paths:
        try:
            normalize_repo_path(repo, str(path), require_exists=False)
        except ValueError as exc:
            errors.append(str(exc))
    if manifest:
        if manifest.get("invocationId") != issuer.get("invocationId"):
            errors.append("receipt/evidence invocation mismatch")
        if manifest.get("targetDigest") != target.get("targetDigest"):
            errors.append("receipt/evidence target mismatch")
        if manifest.get("result") != receipt.get("result"):
            errors.append("receipt/evidence result mismatch")
        if manifest.get("selectedGates") != receipt.get("policy", {}).get(
            "selectedGates"
        ):
            errors.append("receipt/evidence gate mismatch")
        if manifest.get("issuer", {}).get("executableDigest") != issuer.get(
            "executableDigest"
        ):
            errors.append("receipt/evidence issuer mismatch")
        if manifest.get("finalDiffDigest") != target.get("diffDigest"):
            errors.append("receipt/evidence final diff mismatch")
    if receipt.get("result") == "pass" and not manifest:
        errors.append("pass receipt lacks validated executable evidence")

    if current:
        repository = (
            receipt.get("repository")
            if isinstance(receipt.get("repository"), dict)
            else {}
        )
        if repository.get("revision") != current_revision(repo):
            errors.append("receipt revision is stale")
        if repository.get("dirtyStateDigest") != (
            dirty_state_digest(repo) or "CLEAN"
        ):
            errors.append("receipt dirty state is stale")
        policy = (
            receipt.get("policy")
            if isinstance(receipt.get("policy"), dict)
            else {}
        )
        state = policy_state(repo)
        if policy.get("policyVersion") != state["policyVersion"]:
            errors.append("receipt policy is stale")
        if policy.get("classifierVersion") != state["classifierVersion"]:
            errors.append("receipt classifier is stale")
        expected_target = compute_target_digest(
            repo,
            paths=paths,
            mode=str(target.get("mode") or "targeted"),
            threat_model_digest=str(target.get("threatModelDigest") or ""),
            knowledge_base_digest=str(target.get("knowledgeBaseDigest") or ""),
            diff_digest=str(target.get("diffDigest") or ""),
            base_revision=(
                str(target["baseRevision"])
                if target.get("baseRevision")
                else None
            ),
        )
        if target.get("targetDigest") != expected_target:
            errors.append("receipt target digest is stale")
    return errors
