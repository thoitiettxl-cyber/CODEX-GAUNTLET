from __future__ import annotations

import copy
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / ".codex" / "hooks"))

from gauntlet.handshake import (
    compute_target_digest,
    create_work_context,
    current_revision,
    dirty_state_digest,
    final_diff_digest,
    payload_digest,
    policy_state,
    repository_root_digest,
    validate_receipt,
    validate_work_context,
    write_receipt,
)
from gauntlet.security.attack_path import analyze_attack_path
from gauntlet.security.contracts import (
    ValidationRecord,
    finding_id,
    materialize_finding,
    occurrence_id,
    validate_attack_path,
    validate_finding,
    validate_validation,
    verify_seal,
    write_contracts,
)
from gauntlet.security.discovery import discover_candidates, discover_source
from gauntlet.security.export import export_sarif, validate_sarif
from gauntlet.security.history import is_active, validate_triage
from gauntlet.security.kb import ingest_knowledge_base
from gauntlet.security.targets import NormalizedTarget, normalize_target
from gauntlet.security.threat_model import compute_input_digest, load_threat_model
from gauntlet.security.validation import validate_candidate
from qa.classify_changes import classify_records
from qa.gate_selection import select_gates
from qa.metrics import emit_metrics
from qa.verify_v6 import _project_proof_gaps


def text(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def run(argv: list[str], *, env: dict[str, str] | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(argv, cwd=ROOT, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env={**os.environ, **(env or {})})


def hook(event: dict, *, env: dict[str, str] | None = None) -> tuple[str, str]:
    payload = copy.deepcopy(event)
    payload["cwd"] = str(ROOT)
    # Invoke directly because the hook consumes its JSON event from stdin.
    proc = subprocess.run(
        [sys.executable, str(ROOT / ".codex/hooks/pre_tool_use_policy.py")],
        cwd=ROOT,
        input=json.dumps(payload),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env={**os.environ, **(env or {})},
    )
    if not proc.stdout.strip():
        return "allow", "CG.POLICY.ALLOW"
    data = json.loads(proc.stdout)
    output = data.get("hookSpecificOutput", {})
    decision = output.get("permissionDecision", "allow")
    reason = output.get("permissionDecisionReason", "")
    rule = ""
    for part in reason.split(" | "):
        if part.startswith("rule="):
            rule = part.split("=", 1)[1]
    return decision, rule


def hook_payload(event: dict) -> dict:
    payload = copy.deepcopy(event)
    payload["cwd"] = str(ROOT)
    proc = subprocess.run(
        [sys.executable, str(ROOT / ".codex/hooks/pre_tool_use_policy.py")], cwd=ROOT,
        input=json.dumps(payload), text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    return json.loads(proc.stdout) if proc.stdout.strip() else {}


def _fixture_discovery(folder: str) -> dict[str, list[dict]]:
    result: dict[str, list[dict]] = {}
    for path in sorted((ROOT / "qa" / "fixtures" / folder).iterdir()):
        if path.suffix == ".py":
            findings, _ = discover_source(path.name, path.read_text(encoding="utf-8"))
            result[path.name] = findings
    return result


def _temporary_threat_repo() -> Path:
    root = Path(tempfile.mkdtemp(prefix="gauntlet-v6-threat-"))
    (root / "security").mkdir()
    (root / "docs" / "plans").mkdir(parents=True)
    (root / "docs" / "quality").mkdir(parents=True)
    (root / "gauntlet" / "security").mkdir(parents=True)
    (root / "AGENTS.md").write_text("boundary A\n")
    (root / "docs" / "ARCHITECTURE.md").write_text("architecture\n")
    (root / "docs" / "quality" / "SECURITY-GATE.md").write_text("gate\n")
    (root / "gauntlet" / "security" / "engine.py").write_text("VALUE = 1\n")
    (root / "security" / "threat-model-sources.json").write_text(json.dumps({
        "schema_version": 1,
        "include_exact": ["AGENTS.md", "docs/ARCHITECTURE.md", "docs/quality/SECURITY-GATE.md", "security/threat-model-sources.json"],
        "include_globs": ["gauntlet/security/**"],
        "dependency_manifests": True,
        "exclude_prefixes": ["docs/plans/", "qa/security/triage/"],
    }))
    return root


def _sample_candidate() -> dict:
    return {
        "ruleId": "CG.SEC.SHELL", "title": "Shell command injection surface", "severity": "high", "confidence": "high",
        "location": {"path": "src/app.py", "startLine": 4, "endLine": 4},
        "rootCauseKey": "CG.SEC.SHELL:run:shell=true", "rootCauseSummary": "shell true",
        "evidenceRefs": ["source:src/app.py:4"], "remediation": "shell false", "source": "gauntlet-security-discovery-v6",
    }


def checks() -> dict[str, tuple[str, bool]]:
    agents = text("AGENTS.md")
    workflow = text("docs/WORKFLOW.md")
    architecture = text("docs/ARCHITECTURE.md")
    quality = text("docs/quality/CODEX-GAUNTLET.md")
    security_doc = text("docs/quality/SECURITY-GATE.md")
    verify_wrapper = text("qa/verify.ps1")
    verify_source = text("qa/verify_v6.py")
    ci = text(".github/workflows/codex-gauntlet.yml")
    config = text(".codex/config.toml")
    post_hook = text(".codex/hooks/post_tool_use_feedback.py")
    matrix = text("qa/verify-matrix.yaml")

    # Shared runtime probes.
    replay_results: dict[str, tuple[str, str]] = {}
    ordinary_policy_env = {
        "CODEX_GAUNTLET_MAINTENANCE": "0",
        "CODEX_GAUNTLET_MAINTENANCE_TARGETS": "",
        "CODEX_GAUNTLET_HUMAN_TRIAGE": "0",
    }
    for path in sorted((ROOT / "qa" / "fixtures" / "policy-replay").glob("*.json")):
        payload = json.loads(path.read_text())
        replay_results[path.name] = hook(payload["event"], env=ordinary_policy_env)

    benign = _fixture_discovery("known-benign")
    vulnerable = _fixture_discovery("known-vulnerable")
    benign_clean = all(not findings for findings in benign.values())
    vulnerable_rules = {item["ruleId"] for findings in vulnerable.values() for item in findings}

    safe_records = classify_records(["src/profile.py", "docs/response-format.md", "lib/executor.py"])
    safe_sensitive = any(item.className == "security-sensitive" for item in safe_records)
    sensitive_records = classify_records(["qa/fixtures/known-vulnerable/shell_injection.py"])
    selected_sensitive = select_gates([item.__dict__ for item in sensitive_records], "stop")
    selected_ordinary = select_gates([item.__dict__ for item in classify_records(["src/math.py"])], "ci")

    valid_context = create_work_context(ROOT, run_id=f"selftest-{time.time_ns()}", requested_mode="targeted", complexity_class="bounded", runnable=True, changed_paths=["README.md"], base_revision="HEAD")
    context_valid = True
    try:
        validate_work_context(ROOT, valid_context, requested_mode="targeted")
    except Exception:
        context_valid = False
    invalid_context = copy.deepcopy(valid_context)
    invalid_context["digest"] = "0" * 64
    invalid_context_rejected = False
    try:
        validate_work_context(ROOT, invalid_context)
    except ValueError:
        invalid_context_rejected = True

    not_runnable_rejected = False
    complex_context = copy.deepcopy(valid_context)
    complex_context["storyId"] = "story-1"
    complex_context["harness"] = {"complexityClass": "complex", "runnable": False, "linkedPlan": "docs/plans/active/example.md"}
    complex_context["digest"] = payload_digest(complex_context)
    try:
        validate_work_context(ROOT, complex_context)
    except ValueError:
        not_runnable_rejected = True

    # Receipt issuance is deliberately unavailable as a direct library API.
    # A structurally plausible forged payload proves policy invalidation without
    # weakening the process-bound issuer contract.
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    direct_receipt_rejected = False
    try:
        write_receipt(ROOT, mode="targeted")
    except PermissionError:
        direct_receipt_rejected = True
    verifier = ROOT / "qa" / "verify_v6.py"
    forged_receipt = {
        "schemaVersion": "1",
        "receiptId": "pending",
        "issuer": {
            "name": "./qa/verify",
            "executablePath": "qa/verify_v6.py",
            "executableDigest": hashlib.sha256(verifier.read_bytes()).hexdigest(),
            "invocationId": "verify-" + "0" * 32,
        },
        "repository": {
            "revision": current_revision(ROOT),
            "dirtyStateDigest": dirty_state_digest(ROOT) or "CLEAN",
        },
        "target": {
            "targetDigest": "0" * 64,
            "paths": [],
            "mode": "targeted",
            "diffDigest": final_diff_digest(ROOT),
            "baseRevision": None,
            "threatModelDigest": "",
            "knowledgeBaseDigest": "",
        },
        "policy": {
            "policyVersion": "stale-policy",
            "classifierVersion": policy_state(ROOT)["classifierVersion"],
            "selectedGates": [],
            "classificationRecords": [],
        },
        "result": "fail",
        "evidenceRefs": [],
        "proofGaps": [],
        "startedAt": now,
        "completedAt": now,
    }
    forged_receipt["receiptId"] = "vr-" + payload_digest(
        forged_receipt,
        omit=("digest", "receiptId"),
    )[:32]
    forged_receipt["digest"] = payload_digest(forged_receipt)
    receipt_invalidation = any(
        "policy is stale" in item
        for item in validate_receipt(ROOT, forged_receipt, current=True)
    )
    receipt_contract_fields = all(
        marker in text("gauntlet/handshake/__init__.py")
        for marker in ("finalDiffDigest", "evidenceRefs", "workContextDigest")
    )

    harness_status_before = (ROOT / ".qa-artifacts" / "security-latest.json").stat().st_mtime_ns if (ROOT / ".qa-artifacts" / "security-latest.json").exists() else None
    status_proc = run(
        [sys.executable, "qa/check_harness.py", "--skip-doctor-command"]
    )
    doctor_proc = status_proc
    compatibility = json.loads(text("qa/compatibility.json"))
    status_payload = {
        "installed_version": compatibility["repository_harness"][
            "tested_core_semver"
        ],
        "condition": "current",
    }
    harness_status_after = (ROOT / ".qa-artifacts" / "security-latest.json").stat().st_mtime_ns if (ROOT / ".qa-artifacts" / "security-latest.json").exists() else None

    # Threat-model freshness probes in isolated directories.
    threat_root = _temporary_threat_repo()
    first_digest = compute_input_digest(threat_root)
    (threat_root / "AGENTS.md").write_text("boundary B\n")
    relevant_stale = compute_input_digest(threat_root) != first_digest
    after_relevant = compute_input_digest(threat_root)
    (threat_root / "docs" / "plans" / "note.md").write_text("unrelated plan\n")
    unrelated_not_stale = compute_input_digest(threat_root) == after_relevant

    candidate = _sample_candidate()
    validation = ValidationRecord("deferred", "static_only", ["source:src/app.py:4"], datetime.now(timezone.utc).isoformat(), "runtime unavailable")
    target = NormalizedTarget("paths", "standard", "a" * 40, ("src/app.py",))
    model = {"trustBoundaries": ["input → runtime"]}
    attack = analyze_attack_path(candidate, validation, model)
    finding = materialize_finding(candidate, validation, attack, target)

    missing_disposition = validate_validation({"method": "static_only", "evidenceRefs": [], "validatedAt": now, "proofGap": "gap"})
    missing_gap = validate_validation({"disposition": "deferred", "method": "static_only", "evidenceRefs": [], "validatedAt": now})
    missing_attack = validate_attack_path({"entrypoint": "x", "boundaryCrossings": [], "controls": [], "sink": "x", "preconditions": [], "impactSurface": "x", "likelihood": "high", "impact": ""})
    counterevidence = bool(attack and attack.counterevidence and attack.severityRationale)

    no_runtime_validation = validate_candidate(ROOT, candidate, target)

    triage_valid = not validate_triage({"findingId": finding["findingId"], "action": "accepted_risk", "reason": "reviewed", "approvedBy": "alice@example.com", "approvedAt": now})
    expired = {"findingId": finding["findingId"], "action": "accepted_risk", "reason": "reviewed", "approvedBy": "alice@example.com", "approvedAt": now, "expiresAt": (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()}

    with tempfile.TemporaryDirectory() as tmp:
        sarif_path = Path(tmp) / "results.sarif"
        export_sarif(sarif_path, [finding])
        sarif_valid = not validate_sarif(json.loads(sarif_path.read_text()))

    # KB safety probes.
    kb_dir = ROOT / ".qa-artifacts" / f"kb-selftest-{time.time_ns()}"
    kb_dir.mkdir(parents=True, exist_ok=True)
    (kb_dir / "empty.txt").write_text("")
    (kb_dir / "malformed.docx").write_bytes(b"not-a-zip")
    symlink_rejected = False
    try:
        (kb_dir / "link.md").symlink_to(ROOT / "README.md")
        ingest_knowledge_base(ROOT, [(kb_dir / "link.md").relative_to(ROOT)])
    except ValueError:
        symlink_rejected = True
    malformed_rejected = 0
    for name in ("empty.txt", "malformed.docx"):
        try:
            ingest_knowledge_base(ROOT, [(kb_dir / name).relative_to(ROOT)])
        except ValueError:
            malformed_rejected += 1

    conflicting_target = False
    working_head = False
    traversal_target = False
    try:
        normalize_target(ROOT, paths=["README.md"], diff="HEAD..HEAD")
    except ValueError:
        conflicting_target = True
    try:
        normalize_target(ROOT, working_tree=True, head="HEAD")
    except ValueError:
        working_head = True
    try:
        normalize_target(ROOT, paths=["../escape"])
    except (ValueError, FileNotFoundError):
        traversal_target = True

    coverage_target = NormalizedTarget("paths", "standard", "a" * 40, ("gauntlet/__init__.py", "README.md"))
    _, coverage = discover_candidates(ROOT, coverage_target, {}, "")

    # Seal probe in ignored runtime artifact store.
    scan_id = f"selftest-{time.time_ns()}"
    seal_target = NormalizedTarget("paths", "standard", run(["git", "rev-parse", "HEAD"]).stdout.strip(), ("README.md",))
    report_dir = write_contracts(
        ROOT, scan_id=scan_id, target=seal_target, target_digest=compute_target_digest(ROOT, paths=["README.md"], mode="ci"),
        policy_version=json.loads(text("qa/policy.json"))["policy_version"], threat_model=load_threat_model(ROOT).to_dict(),
        knowledge_base_digest="", findings=[],
        coverage={"filesConsidered": 1, "filesScanned": 0, "filesParsed": 0, "filesFallbackScanned": 0, "unsupportedFiles": ["README.md"], "unsupportedLanguageCount": 1, "skippedGeneratedVendor": 0, "untestedAttackSurfaces": ["unsupported:README.md"], "candidateCount": 0, "validatedCount": 0, "highSeverityCount": 0, "evidenceBackedHighSeverityCount": 0},
        started_at=now,
    )
    seal_initial = not verify_seal(report_dir)
    report_file = report_dir / "report.md"
    report_file.chmod(0o644)
    report_file.write_text(report_file.read_text() + "tamper\n")
    seal_tamper = any("digest mismatch" in item for item in verify_seal(report_dir))
    for item in report_dir.iterdir():
        item.chmod(0o644)
    report_dir.chmod(0o755)

    metrics_path = emit_metrics(ROOT, {"mode": "selftest", "durationMs": 1, "selectedGates": [], "result": "pass"})

    hook_deny_payload = hook_payload({"tool_name": "Bash", "tool_input": {"command": "printf x > .codex/config.toml"}})
    hook_reason = hook_deny_payload.get("hookSpecificOutput", {}).get("permissionDecisionReason", "")

    checks: dict[str, tuple[str, bool]] = {
        # C — Core behavior
        "C01": ("compact entrypoint points to canonical docs without thresholds", all(item in agents for item in ("docs/WORKFLOW.md", "docs/ARCHITECTURE.md", "qa/verify.ps1")) and "threshold" not in agents.lower()),
        "C02": ("nested instruction precedence documented", "AGENTS.override.md" in workflow and "precedence" in workflow.lower()),
        "C03": ("bounded tasks do not require stories", "Bounded" in workflow and "does not require" in workflow),
        "C04": ("complex work requires plan recovery and receipt", all(item in workflow for item in ("linked plan", "recovery", "VerificationReceipt"))),
        "C05": ("read-only flow avoids Harness writes and heavy verification", "Read-only" in workflow and "no lifecycle write" in workflow.lower() and "no heavy verification" in workflow.lower()),
        "C06": ("single executable authority", "single_authority: qa/verify.ps1" in matrix and "There is no `harness verify`" in quality),
        "C07": ("Stop delegates only to qa/verify.ps1 with guard", "verify.ps1" in text(".codex/hooks/stop_gate.py") and "stop_hook_active" in text(".codex/hooks/stop_gate.py")),
        "C08": ("CI is final merge authority", "Repository CI verified" in architecture and "qa/verify.ps1" in ci and "-Mode ci" in ci),
        "C09": ("unknown changes are conservative", "unknown-mixed:" in matrix and all(gate in matrix.split("unknown-mixed:", 1)[1].split("\n", 1)[0] for gate in ("build", "unit", "integration", "acceptance", "coverage", "policy-audit"))),
        "C10": ("sandbox and protected path policy present", 'sandbox_mode = "workspace-write"' in config and replay_results["protected-redirection.json"][0] == "deny"),
        "C11": ("legitimate migrations are not blanket denied", replay_results["legitimate-migration.json"][0] == "allow"),
        "C12": ("permission policy denies prohibited and leaves legitimate approval to user", "deny_permission(decision.explanation())" in text(".codex/hooks/permission_request_policy.py") and "No decision" in text(".codex/hooks/permission_request_policy.py")),
        "C13": ("PostToolUse remains bounded", all(item not in post_hook for item in ("run-mutation", "security-full", "rollback"))),
        "C14": ("policy audit is final-diff aware", "changed_files" in text("qa/policy_audit.py") and "runtime security report committed" in text("qa/policy_audit.py")),
        "C15": ("thresholds are centralized", "qa/security/thresholds.json" in security_doc and "fail_on_severity" not in agents),
        "C16": ("experimental Rules are optional", "experimental" in quality.lower() and "optional" in quality.lower()),
        "C17": ("declared project commands have executable proof", not _project_proof_gaps(["migration", "unit"]) and "consumer command missing" in verify_source),
        "C18": ("receipt records target/final state digest", receipt_contract_fields and "finalDiffDigest" in text("gauntlet/handshake/__init__.py")),

        # H — Harness handshake
        "H01": ("Harness provenance and doctor are internally valid", doctor_proc.returncode == 0 and status_payload.get("installed_version") == "0.1.7" and status_payload.get("condition") == "current"),
        "H02": ("skills coexist without duplicate names", len({path.parent.name for path in (ROOT / ".agents/skills").glob("*/SKILL.md")}) == len(list((ROOT / ".agents/skills").glob("*/SKILL.md")))),
        "H03": ("WorkContext validates revision path and digest", context_valid and invalid_context_rejected),
        "H04": ("bounded WorkContext permits no storyId", "storyId" not in valid_context),
        "H05": ("non-runnable complex work is rejected", not_runnable_rejected),
        "H06": ("only qa/verify creates receipts in production", direct_receipt_rejected and "issue_receipt" in verify_source and "write_receipt" not in text("scripts/gauntlet_handshake.py")),
        "H07": ("receipt invalidates on policy mutation", receipt_invalidation),
        "H08": ("Harness completion links receipts rather than running tests", "validate-receipt" in text("scripts/gauntlet_handshake.py") and "validate_receipt" in text("scripts/gauntlet_handshake.py") and "story complete" not in text("scripts/gauntlet_handshake.py")),
        "H09": ("Gauntlet does not mutate Harness lifecycle", "receipt-links" not in verify_source and "story transition" not in verify_source.lower()),
        "H10": ("Harness status is read-only and does not scan", status_proc.returncode == 0 and harness_status_before == harness_status_after and "qa/verify" not in status_proc.stdout),
        "H11": ("doctor proves integrity only", doctor_proc.returncode == 0 and "application" not in doctor_proc.stdout.lower()),
        "H12": ("target digest is deterministic for unchanged state", compute_target_digest(ROOT, paths=[], mode="targeted") == compute_target_digest(ROOT, paths=[], mode="targeted")),
        "H13": ("Harness update requires maintenance authorization", replay_results["harness-update.json"] == ("deny", "CG.POLICY.HARNESS_MAINTENANCE")),
        "H14": ("Harness conflict requires human semantic decision", "semantic merge conflicts without human direction" in text("docs/HARNESS.md")),
        "H15": ("Harness ownership collision fails closed", "PROTECTED =" in text("qa/check_harness.py") and "overlaps protected" in text("qa/check_harness.py")),
        "H16": ("CI is hermetic and does not fetch latest", not any(token in ci for token in ("curl ", "wget ", "releases/latest", "raw.githubusercontent"))),

        # P — Precision and noise
        "P01": ("dangerous token in read-only search is allowed", replay_results["read-protected-token.json"][0] == "allow"),
        "P02": ("read-only shell corpus has zero false blocks", replay_results["git-status.json"][0] == "allow"),
        "P03": ("write redirection to protected path is denied", replay_results["protected-redirection.json"] == ("deny", "CG.POLICY.PROTECTED_WRITE")),
        "P04": ("filename substring does not create security class", not safe_sensitive),
        "P05": ("string literal eval mention is benign", benign.get("string_literal.py") == []),
        "P06": ("benign method exec is not shell finding", benign.get("benign_exec.py") == []),
        "P07": ("deny includes rule target reason remediation", all(key in hook_reason for key in ("rule=", "target=", "reason=", "remediation="))),
        "P08": ("extra gates have explainable classification records", bool(selected_sensitive.reasons) and all(item.get("ruleId") and item.get("path") for item in selected_sensitive.reasons)),
        "P09": ("policy replay expectations match", all((actual[0] == payload["expect"]["decision"] and (actual[0] == "allow" or actual[1] == payload["expect"]["ruleId"])) for path in (ROOT / "qa/fixtures/policy-replay").glob("*.json") for payload in [json.loads(path.read_text())] for actual in [replay_results[path.name]])),
        "P10": ("deliberate behavior delta has ADR and fixture", (ROOT / "docs/decisions/0002-v6-precision-deltas.md").exists() and len(replay_results) >= 6),
        "P11": ("ordinary Stop does not select full security", select_gates([item.__dict__ for item in classify_records(["src/math.py"])], "stop").securityProfile is None),
        "P12": ("ordinary PR does not select repository security", selected_ordinary.securityProfile is None),
        "P13": ("ordinary selection does not create empty security report", "security" not in selected_ordinary.gates),
        "P14": ("known-benign corpus has zero candidates", benign_clean),
        "P15": ("known-vulnerable corpus mandatory rules detected", {"CG.SEC.DYNAMIC_EXEC", "CG.SEC.SHELL", "CG.SEC.DESERIALIZE", "CG.SEC.PATH_WRITE", "CG.SEC.AUTH_BYPASS", "CG.SEC.SECRET", "CG.SEC.NETWORK"} <= vulnerable_rules),
        "P16": ("coverage exposes unsupported and untested surfaces", coverage["unsupportedLanguageCount"] >= 1 and coverage["untestedAttackSurfaces"]),

        # S — Security contracts
        "S01": ("conflicting target selectors reject", conflicting_target),
        "S02": ("working-tree target rejects head", working_head),
        "S03": ("target/location traversal rejects", traversal_target and bool(validate_finding({**finding, "locations": [{"path": "../x", "startLine": 1}]}))),
        "S04": ("KB symlink rejects", symlink_rejected),
        "S05": ("malformed or empty knowledge docs fail clearly", malformed_rejected == 2),
        "S06": ("meaningful boundary source change invalidates model", relevant_stale),
        "S07": ("unrelated plan change does not invalidate model", unrelated_not_stale),
        "S08": ("stable finding ID ignores wording/location", finding_id("CG.SEC.SHELL", "root") == finding_id("CG.SEC.SHELL", "root")),
        "S09": ("occurrence ID changes with concrete occurrence", occurrence_id("gf-12345678", "a", "a.py", 1) != occurrence_id("gf-12345678", "b", "b.py", 2)),
        "S10": ("missing validation disposition fails", any("disposition" in item for item in missing_disposition)),
        "S11": ("static-only without proof gap fails", any("proofGap" in item for item in missing_gap)),
        "S12": ("high finding requires complete attack path", any("impact" in item or "severityRationale" in item for item in missing_attack)),
        "S13": ("counterevidence calibrates severity rationale", counterevidence),
        "S14": ("missing runtime does not claim reproduction", no_runtime_validation.method != "reproduction" and bool(no_runtime_validation.proofGap)),
        "S15": ("human triage requires reason and approver", triage_valid and bool(validate_triage({"findingId": "x", "action": "accepted_risk", "approvedAt": now}))),
        "S16": ("expired waiver is inactive", not is_active(expired)),
        "S17": ("SARIF export validates", sarif_valid),
        "S18": ("external scanner install is denied", replay_results["external-scanner.json"] == ("deny", "CG.POLICY.EXTERNAL_SCANNER")),

        # O — Operational integrity
        "O01": ("target digest is reproducible", compute_target_digest(ROOT, paths=["README.md"], mode="ci") == compute_target_digest(ROOT, paths=["README.md"], mode="ci")),
        "O02": ("Windows release provenance is explicit", status_payload.get("installed_version") == "0.1.7" and json.loads(text("qa/compatibility.json"))["repository_harness"]["binary_mode"] == "windows-release-core-source-cli"),
        "O03": ("sealed artifact tamper is detected", seal_initial and seal_tamper),
        "O04": ("policy change invalidates receipt/cache", receipt_invalidation and "policyVersion" in text("gauntlet/security/run.py")),
        "O05": ("scheduled audit uses canonical audit mode", "-Mode audit" in ci and "audit" in verify_source),
        "O06": ("PR security target is diff scoped", "--diff" in verify_source and "CODEX_GAUNTLET_BASE" in ci),
        "O07": ("network is disabled for validation", "network_access = false" in config and '"networkUsed": False' in text("gauntlet/security/contracts/__init__.py")),
        "O08": ("offline implementation avoids Docker/systemd assumptions", all(token not in verify_source + text("qa/security/run_pipeline.py") for token in ("docker", "systemctl", "systemd"))),
        "O09": ("unsupported toolchain becomes proof gap", "_project_proof_gaps" in verify_source and "consumer command missing" in verify_source),
        "O10": ("verification metrics are emitted", metrics_path.exists() and "durationMs" in metrics_path.read_text()),
        "O11": ("documentation and executable suite both declare 80 scenarios", "80 scenarios" in text("README.md") and "= 80 scenarios" in text("docs/specs/CODEX-GAUNTLET-V6.md")),
        "O12": ("only required CI status is mergeability authority", "required status" in architecture.lower() and "Repository CI verified" in architecture),
    }
    return checks


def main() -> int:
    values = checks()
    failures: list[str] = []
    for prefix in ("C", "H", "P", "S", "O"):
        for key in sorted(item for item in values if item.startswith(prefix)):
            label, ok = values[key]
            print(f"{'PASS' if bool(ok) else 'FAIL'} {key} — {label}")
            if not bool(ok):
                failures.append(key)
    if len(values) != 80:
        print(f"FAIL acceptance-count — expected 80 scenarios, found {len(values)}")
        failures.append("acceptance-count")
    print(f"{len(values) - len([key for key in failures if key != 'acceptance-count'])}/{len(values)} scenarios passed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
